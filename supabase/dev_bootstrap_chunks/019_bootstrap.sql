CREATE OR REPLACE FUNCTION public.complete_exam_session(p_session_id UUID)
RETURNS public.test_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.test_sessions;
    v_txid BIGINT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO result
    FROM public.test_sessions
    WHERE id = p_session_id
      AND user_id = auth.uid()
    FOR UPDATE;

    IF result.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF result.is_completed THEN
        RETURN result;
    END IF;

    IF result.session_type IN ('timed', 'fixed_timed') THEN
        v_txid := txid_current();

        INSERT INTO private.exam_timed_finalization_context(
            transaction_id,
            user_id,
            session_id
        ) VALUES (
            v_txid,
            result.user_id,
            result.id
        );

        INSERT INTO public.user_answers (
            test_session_id,
            user_id,
            question_id,
            selected_option_id,
            is_correct,
            is_flagged,
            time_spent_seconds
        )
        SELECT
            result.id,
            result.user_id,
            tsq.question_id,
            NULL,
            FALSE,
            FALSE,
            0
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = result.id
          AND NOT EXISTS (
              SELECT 1
              FROM public.user_answers ua
              WHERE ua.test_session_id = result.id
                AND ua.user_id = result.user_id
                AND ua.question_id = tsq.question_id
          );

        DELETE FROM private.exam_timed_finalization_context ctx
        WHERE ctx.transaction_id = v_txid
          AND ctx.user_id = result.user_id
          AND ctx.session_id = result.id;
    END IF;

    UPDATE public.test_sessions
    SET is_completed = TRUE
    WHERE id = result.id
      AND user_id = result.user_id
      AND is_completed = FALSE
    RETURNING * INTO result;

    RETURN result;
END;
$$;

-- Avoid PostgREST PGRST121/500 failures caused by malformed custom `PGRST`
-- JSON error payloads. These security paths only need stable HTTP statuses and
-- human-readable messages, so use PostgREST's PTxxx SQLSTATE mapping directly.
--
-- Security semantics are unchanged:
-- - invalid/missing gateway proof => 403
-- - missing authentication => 401
-- - unsupported recorder action => 400
-- - all gateway verification, rate-limit escalation, entitlement, quota and
--   disclosure behavior remains authoritative and unchanged.

CREATE OR REPLACE FUNCTION public.record_exam_gateway_rate_limit_rejection(
    p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_cfg private.exam_security_config%ROWTYPE;
    v_state private.exam_security_account_state%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_reject_count INTEGER;
    v_reject_started TIMESTAMPTZ;
    v_escalation_count INTEGER;
    v_escalation_started TIMESTAMPTZ;
    v_escalated BOOLEAN := FALSE;
    v_block_for INTERVAL;
    v_block_until TIMESTAMPTZ;
BEGIN
    IF COALESCE(
        NULLIF(current_setting('request.royal_gateway_verified', TRUE), ''),
        '0'
    ) <> '1' THEN
        RAISE SQLSTATE 'PT403'
            USING MESSAGE = 'Exam gateway required';
    END IF;

    IF v_user_id IS NULL THEN
        RAISE SQLSTATE 'PT401'
            USING MESSAGE = 'Authentication required';
    END IF;

    IF p_action IS NULL OR p_action <> ALL (ARRAY[
        'create',
        'bootstrap',
        'window',
        'submit',
        'submitRaw',
        'feedback',
        'flag',
        'complete'
    ]::TEXT[]) THEN
        RAISE SQLSTATE 'PT400'
            USING MESSAGE = 'Unsupported exam action';
    END IF;

    SELECT * INTO v_cfg
    FROM private.exam_security_config
    WHERE singleton = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXAM_SECURITY_CONFIG_MISSING';
    END IF;

    IF NOT v_cfg.gateway_abuse_escalation_enabled THEN
        RETURN jsonb_build_object('recorded', FALSE, 'escalated', FALSE);
    END IF;

    -- Fail fast instead of sleeping on a database worker. The gateway still returns
    -- the original 429 even if this optional abuse-accounting write loses a race.
    IF NOT private.try_exam_security_lock(v_user_id) THEN
        RETURN jsonb_build_object('recorded', FALSE, 'escalated', FALSE);
    END IF;

    INSERT INTO private.exam_security_account_state(user_id)
    VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_state
    FROM private.exam_security_account_state state
    WHERE state.user_id = v_user_id
    FOR UPDATE;

    IF v_state.gateway_reject_window_started_at IS NULL
       OR v_state.gateway_reject_window_started_at <= v_now - v_cfg.gateway_reject_window THEN
        v_reject_started := v_now;
        v_reject_count := 1;
    ELSE
        v_reject_started := v_state.gateway_reject_window_started_at;
        v_reject_count := v_state.gateway_reject_count + 1;
    END IF;

    v_escalation_started := v_state.gateway_escalation_window_started_at;
    v_escalation_count := v_state.gateway_escalation_count;

    IF v_reject_count >= v_cfg.gateway_reject_threshold THEN
        v_escalated := TRUE;
        v_reject_count := 0;
        v_reject_started := v_now;

        IF v_escalation_started IS NULL
           OR v_escalation_started <= v_now - v_cfg.gateway_escalation_window THEN
            v_escalation_started := v_now;
            v_escalation_count := 1;
        ELSE
            v_escalation_count := LEAST(v_escalation_count + 1, 3);
        END IF;

        v_block_for := CASE v_escalation_count
            WHEN 1 THEN v_cfg.gateway_first_block
            WHEN 2 THEN v_cfg.gateway_second_block
            ELSE v_cfg.gateway_third_block
        END;
        v_block_until := v_now + v_block_for;
    END IF;

    UPDATE private.exam_security_account_state state
    SET
        gateway_reject_count = v_reject_count,
        gateway_reject_window_started_at = v_reject_started,
        gateway_escalation_count = v_escalation_count,
        gateway_escalation_window_started_at = v_escalation_started,
        gateway_last_rejected_at = v_now,
        gateway_last_escalated_at = CASE
            WHEN v_escalated THEN v_now
            ELSE state.gateway_last_escalated_at
        END,
        question_blocked_until = CASE
            WHEN NOT v_escalated THEN state.question_blocked_until
            WHEN state.question_blocked_until IS NULL THEN v_block_until
            ELSE GREATEST(state.question_blocked_until, v_block_until)
        END,
        question_block_reason = CASE
            WHEN v_escalated
                 AND (state.question_blocked_until IS NULL OR state.question_blocked_until < v_block_until)
                THEN 'RATE_LIMITED'
            ELSE state.question_block_reason
        END,
        session_create_blocked_until = CASE
            WHEN NOT v_escalated THEN state.session_create_blocked_until
            WHEN state.session_create_blocked_until IS NULL THEN v_block_until
            ELSE GREATEST(state.session_create_blocked_until, v_block_until)
        END,
        session_create_block_reason = CASE
            WHEN v_escalated
                 AND (state.session_create_blocked_until IS NULL OR state.session_create_blocked_until < v_block_until)
                THEN 'RATE_LIMITED'
            ELSE state.session_create_block_reason
        END,
        risk_score = CASE
            WHEN v_escalated AND v_escalation_count >= 3
                THEN GREATEST(state.risk_score, v_cfg.gateway_high_risk_score)
            ELSE state.risk_score
        END,
        updated_at = v_now
    WHERE state.user_id = v_user_id;

    -- Keep the event stream sparse: one row per escalation, never one row per request.
    IF v_escalated THEN
        INSERT INTO private.exam_security_events(
            user_id,
            event_type,
            occurred_at,
            metadata
        ) VALUES (
            v_user_id,
            'gateway_rate_limit_escalated',
            v_now,
            jsonb_build_object(
                'action', p_action,
                'level', v_escalation_count,
                'block_seconds', EXTRACT(EPOCH FROM v_block_for)::INTEGER
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'recorded', TRUE,
        'escalated', v_escalated
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_exam_gateway_rate_limit_rejection(TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_exam_gateway_rate_limit_rejection(TEXT)
    TO authenticated;

CREATE OR REPLACE FUNCTION api_hooks.royal_exam_pre_request()
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    v_cfg private.exam_gateway_config%ROWTYPE;
    v_path TEXT := NULLIF(current_setting('request.path', TRUE), '');
    v_method TEXT := UPPER(COALESCE(NULLIF(current_setting('request.method', TRUE), ''), ''));
    v_headers JSONB := COALESCE(
        NULLIF(current_setting('request.headers', TRUE), ''),
        '{}'
    )::jsonb;
    v_rpc_name TEXT;
    v_key_id TEXT;
    v_key TEXT;
BEGIN
    -- Always clear the proof marker before evaluating this request. Clients cannot
    -- make this marker authoritative; only this hook sets it to 1 after key validation.
    PERFORM set_config('request.royal_gateway_verified', '0', TRUE);

    SELECT * INTO v_cfg
    FROM private.exam_gateway_config
    WHERE singleton = TRUE;

    IF NOT FOUND OR NOT v_cfg.enforcement_enabled THEN
        RETURN;
    END IF;

    v_rpc_name := substring(COALESCE(v_path, '') FROM '/rpc/([^/?]+)$');

    IF v_method <> 'POST'
       OR v_rpc_name IS NULL
       OR v_rpc_name <> ALL (ARRAY[
            'create_exam_session_bootstrap',
            'create_exam_session_bootstrap_idempotent',
            'get_exam_session_bootstrap',
            'get_exam_session_window',
            'submit_exam_answer_with_feedback',
            'submit_exam_answer',
            'get_exam_question_feedback',
            'set_question_flag',
            'complete_exam_session',
            'record_exam_gateway_rate_limit_rejection'
       ]::TEXT[]) THEN
        RETURN;
    END IF;

    v_key_id := NULLIF(v_headers->>'x-royal-gateway-key-id', '');
    v_key := NULLIF(v_headers->>'x-royal-gateway-key', '');

    IF v_key_id IS NULL
       OR v_key IS NULL
       OR NOT private.is_valid_exam_gateway_key(v_key_id, v_key, clock_timestamp()) THEN
        RAISE SQLSTATE 'PT403'
            USING MESSAGE = 'Exam gateway required';
    END IF;

    PERFORM set_config('request.royal_gateway_verified', '1', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request()
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION api_hooks.royal_exam_pre_request()
    TO anon, authenticated, service_role, authenticator;

-- Keep the schema-qualified pre-request hook registration explicit and reload
-- PostgREST configuration so production picks up the replacement immediately.
ALTER ROLE authenticator
    SET pgrst.db_pre_request = 'api_hooks.royal_exam_pre_request';

NOTIFY pgrst, 'reload config';

-- Royal access model: one premium entitlement source + bank-scoped libraries.
--
-- Premium access is authoritative only in public.user_access_grants.
-- A bank entitlement covers both the question bank and its mapped library.
-- Trial users may open a limited number of unique articles per bank.

ALTER TABLE public.question_banks
    ADD COLUMN IF NOT EXISTS free_trial_article_limit INTEGER NOT NULL DEFAULT 10;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'question_banks_free_trial_article_limit_check'
          AND conrelid = 'public.question_banks'::regclass
    ) THEN
        ALTER TABLE public.question_banks
            ADD CONSTRAINT question_banks_free_trial_article_limit_check
            CHECK (free_trial_article_limit >= 0);
    END IF;
END;
$$;

COMMENT ON COLUMN public.question_banks.free_trial_article_limit IS
    'Lifetime count of unique library articles a non-premium user may disclose for this trial bank. Ignored when the bank is not trial-enabled.';

CREATE TABLE IF NOT EXISTS public.question_bank_library_articles (
    question_bank_id BIGINT NOT NULL
        REFERENCES public.question_banks(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL
        REFERENCES public.library_articles(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (question_bank_id, article_id)
);

COMMENT ON TABLE public.question_bank_library_articles IS
    'Maps library articles to the question bank whose entitlement controls access. One article may be mapped to multiple banks.';

ALTER TABLE public.question_bank_library_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage bank library mappings"
    ON public.question_bank_library_articles;

CREATE POLICY "Admins manage bank library mappings"
    ON public.question_bank_library_articles
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_question_bank_library_articles_article
    ON public.question_bank_library_articles(article_id, question_bank_id);

CREATE TABLE IF NOT EXISTS private.library_article_disclosures (
    user_id UUID NOT NULL
        REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_bank_id BIGINT NOT NULL
        REFERENCES public.question_banks(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL
        REFERENCES public.library_articles(id) ON DELETE CASCADE,
    first_disclosed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, question_bank_id, article_id)
);

COMMENT ON TABLE private.library_article_disclosures IS
    'Immutable per-user unique article disclosure ledger used to enforce bank library free-trial quotas.';

CREATE INDEX IF NOT EXISTS idx_library_article_disclosures_user_bank
    ON private.library_article_disclosures(user_id, question_bank_id, first_disclosed_at);

-- Existing MRCP Part 1 library content belongs to the current MRCP Part 1 main bank.
-- Use stable product identifiers rather than generated numeric ids.
INSERT INTO public.question_bank_library_articles(question_bank_id, article_id)
SELECT qb.id, la.id
FROM public.question_banks qb
JOIN public.pathways p ON p.id = qb.pathway_id
CROSS JOIN public.library_articles la
WHERE p.slug = 'mrcp-part-1'
  AND qb.name = 'MRCP Part 1 Main Bank'
ON CONFLICT (question_bank_id, article_id) DO NOTHING;

-- user_access_grants is now the only premium entitlement source.
CREATE OR REPLACE FUNCTION public.has_premium_question_bank_access(p_bank_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND (
            public.is_support_or_admin()
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_access_grants grant_row
                  ON grant_row.user_id = auth.uid()
                 AND grant_row.starts_at <= now()
                 AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
                 AND (
                     grant_row.scope_type = 'global'
                     OR (
                         grant_row.scope_type = 'pathway'
                         AND grant_row.pathway_id = qb.pathway_id
                     )
                     OR (
                         grant_row.scope_type = 'bank'
                         AND grant_row.question_bank_id = qb.id
                     )
                 )
                WHERE qb.id = p_bank_id
            )
        );
$$;

-- Refuse to destroy unexpected legacy entitlement data. The current production
-- table is empty; if a future environment has rows they must be migrated first.
DO $$
BEGIN
    IF to_regclass('public.user_pathway_access') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.user_pathway_access) THEN
        RAISE EXCEPTION 'LEGACY_USER_PATHWAY_ACCESS_NOT_EMPTY';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.grant_user_pathway_access(
    UUID, BIGINT, TEXT, INTEGER, TIMESTAMPTZ
);

DROP TABLE IF EXISTS public.user_pathway_access;

-- Direct student reads of article bodies are no longer allowed. Content must go
-- through the disclosure-aware RPC below. Existing admin policy remains intact.
DROP POLICY IF EXISTS "Active users can read library articles"
    ON public.library_articles;
