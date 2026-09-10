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
    -- This RPC is intentionally callable only through a request for which the
    -- PostgREST pre-request hook validated the server-side Royal gateway key.
    IF COALESCE(
        NULLIF(current_setting('request.royal_gateway_verified', TRUE), ''),
        '0'
    ) <> '1' THEN
        RAISE SQLSTATE 'PGRST' USING
            MESSAGE = jsonb_build_object(
                'code', 'GATEWAY_REQUIRED',
                'message', 'Exam gateway required'
            )::text,
            DETAIL = jsonb_build_object(
                'status', 403,
                'status_text', 'Forbidden'
            )::text;
    END IF;

    IF v_user_id IS NULL THEN
        RAISE SQLSTATE 'PGRST' USING
            MESSAGE = jsonb_build_object(
                'code', 'AUTH_REQUIRED',
                'message', 'Authentication required'
            )::text,
            DETAIL = jsonb_build_object(
                'status', 401,
                'status_text', 'Unauthorized'
            )::text;
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
        RAISE SQLSTATE 'PGRST' USING
            MESSAGE = jsonb_build_object(
                'code', 'INVALID_EXAM_ACTION',
                'message', 'Unsupported exam action'
            )::text,
            DETAIL = jsonb_build_object(
                'status', 400,
                'status_text', 'Bad Request'
            )::text;
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

-- Extend the existing PostgREST bypass guard to cover the abuse-accounting RPC.
-- The hook still validates the same server-only gateway key and keeps all existing
-- protected exam RPC behavior unchanged.
CREATE OR REPLACE FUNCTION public.royal_exam_pre_request()
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
        RAISE SQLSTATE 'PGRST' USING
            MESSAGE = jsonb_build_object(
                'code', 'GATEWAY_REQUIRED',
                'message', 'Exam gateway required'
            )::text,
            DETAIL = jsonb_build_object(
                'status', 403,
                'status_text', 'Forbidden'
            )::text;
    END IF;

    PERFORM set_config('request.royal_gateway_verified', '1', TRUE);
END;
$$;

-- Keep the PostgREST pre-request hook callable by the impersonated API roles while
-- removing it from the exposed `public` RPC surface. PostgREST accepts a
-- schema-qualified db-pre-request function and invokes it after role switching.
--
-- This is intentionally a schema move of the already-tested function rather than a
-- rewrite, so gateway validation behavior and transaction-local proof semantics stay
-- byte-for-byte the same.

CREATE SCHEMA IF NOT EXISTS api_hooks;

REVOKE ALL ON SCHEMA api_hooks FROM PUBLIC;

GRANT USAGE ON SCHEMA api_hooks TO anon, authenticated, service_role, authenticator;

ALTER FUNCTION public.royal_exam_pre_request()
    SET SCHEMA api_hooks;

REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request()
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION api_hooks.royal_exam_pre_request()
    TO anon, authenticated, service_role, authenticator;

ALTER ROLE authenticator
    SET pgrst.db_pre_request = 'api_hooks.royal_exam_pre_request';

NOTIFY pgrst, 'reload config';

-- The locked question set is security-sensitive. Authenticated clients only need to
-- read their own locked rows; all writes are performed by trusted SECURITY DEFINER
-- session-creation functions. Leaving client INSERT permission in place lets an
-- authenticated user append arbitrary question ids to an owned session.

DROP POLICY IF EXISTS "Users can insert own session questions"
    ON public.test_session_questions;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.test_session_questions
    FROM anon, authenticated;

-- Session creation is also RPC-only. Existing owner UPDATE/DELETE permissions stay
-- unchanged because resume/completion/delete workflows legitimately use them.
REVOKE INSERT
    ON TABLE public.test_sessions
    FROM anon, authenticated;

-- Close fresh-content bypasses discovered during the X security audit.
--
-- A session bootstrap intentionally exposes future question ids for client-side
-- navigation/progress, but it must never be possible to turn those ids into an
-- answer, feedback payload, or targeted flag before the question has actually been
-- disclosed through the guarded window path.
--
-- Existing answered history was backfilled into private.question_disclosures by
-- migration 012, so this preserves earned feedback/review for historical content.

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    option_is_correct BOOLEAN;
    trusted_timed_finalization BOOLEAN :=
        COALESCE(current_setting('app.timed_finalization', true), '') = 'on';
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Answer user does not match authenticated user';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = NEW.test_session_id
          AND ts.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    -- A selected answer is allowed only after the content has been disclosed at
    -- least once to this user. Timed End Block is the one intentional exception:
    -- it inserts NULL selections for unanswered questions so scoring/finality can
    -- complete without revealing those questions.
    IF NEW.selected_option_id IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = NEW.user_id
              AND d.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    IF NEW.selected_option_id IS NULL THEN
        IF NOT trusted_timed_finalization THEN
            RAISE EXCEPTION 'Submitted answer requires a selected option';
        END IF;
        NEW.is_correct := FALSE;
    ELSE
        SELECT o.is_correct INTO option_is_correct
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected option does not belong to question';
        END IF;

        NEW.is_correct := option_is_correct;
    END IF;

    IF to_regclass('public.test_session_questions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM public.test_session_questions tsq
            WHERE tsq.test_session_id = NEW.test_session_id
              AND tsq.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_exam_question_feedback(
    p_session_id UUID,
    p_question_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    session_row public.test_sessions;
    answer_row public.user_answers;
    correct_option_id BIGINT;
    explanation TEXT;
    percentages JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO session_row
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF NOT public.can_access_question_bank(session_row.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = p_session_id
          AND tsq.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'Question does not belong to session';
    END IF;

    -- Timed completion can create an unanswered bookkeeping row for a question the
    -- user never saw. That row must not turn into an explanation/correct-answer
    -- oracle after End Block.
    IF NOT EXISTS (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = auth.uid()
          AND d.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    SELECT * INTO answer_row
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
      AND ua.question_id = p_question_id;

    IF answer_row.id IS NULL THEN
        RAISE EXCEPTION 'Question has not been answered';
    END IF;

    IF NOT session_row.is_completed
       AND session_row.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Feedback is unavailable until End Block';
    END IF;

    SELECT o.id INTO correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT q.explanation_html INTO explanation
    FROM public.questions q
    WHERE q.id = p_question_id;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    )
    INTO percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', answer_row.selected_option_id,
        'is_correct', answer_row.is_correct,
        'correct_option_id', correct_option_id,
        'explanation_html', explanation,
        'option_percentages', percentages
    );
END;
$$;
