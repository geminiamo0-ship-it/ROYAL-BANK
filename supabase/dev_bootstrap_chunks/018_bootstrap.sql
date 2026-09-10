CREATE OR REPLACE FUNCTION public.get_exam_session_answers(p_session_id UUID)
RETURNS TABLE(
    question_id BIGINT,
    selected_option_id BIGINT,
    is_correct BOOLEAN,
    correct_option_id BIGINT,
    time_spent_seconds INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    session_row public.test_sessions;
    reveal_correctness BOOLEAN;
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

    reveal_correctness := session_row.is_completed
        OR session_row.session_type IN ('standard', 'tutor');

    RETURN QUERY
    SELECT
        ua.question_id,
        ua.selected_option_id,
        CASE WHEN reveal_correctness THEN ua.is_correct ELSE NULL END,
        CASE
            WHEN reveal_correctness AND disclosed.question_id IS NOT NULL
                THEN correct_option.id
            ELSE NULL
        END,
        ua.time_spent_seconds
    FROM public.user_answers ua
    LEFT JOIN private.question_disclosures disclosed
      ON disclosed.user_id = ua.user_id
     AND disclosed.question_id = ua.question_id
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) correct_option ON TRUE
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
    ORDER BY ua.answered_at, ua.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_question_flag(
    p_question_id BIGINT,
    p_flagged BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_questions qbq
        WHERE qbq.question_id = p_question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    ) THEN
        RAISE EXCEPTION 'Question access denied';
    END IF;

    -- Flagging is a UI action on content the user has actually seen. Requiring a
    -- disclosure prevents enumerated question ids from being converted into a
    -- targeted flagged-only fresh-content selector. Unflagging remains allowed so a
    -- legacy/stale flag can always be removed.
    IF p_flagged
       AND NOT EXISTS (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = auth.uid()
              AND d.question_id = p_question_id
       ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    IF p_flagged THEN
        INSERT INTO public.user_question_flags (user_id, question_id)
        VALUES (auth.uid(), p_question_id)
        ON CONFLICT (user_id, question_id) DO NOTHING;
    ELSE
        DELETE FROM public.user_question_flags
        WHERE user_id = auth.uid()
          AND question_id = p_question_id;
    END IF;

    RETURN p_flagged;
END;
$$;

-- X-audit hardening for client-controlled write surfaces.
--
-- 1. profiles: the old self-update RLS policy restricted rows, not columns. Because
--    authenticated had table UPDATE, an owner could attempt to mutate privileged
--    columns such as role/subscription_tier/is_active directly. All legitimate user
--    profile edits already have the narrow update_my_profile() SECURITY DEFINER RPC;
--    staff privilege changes use admin_update_user_access().
--
-- 2. user_question_flags: direct INSERT/DELETE could bypass the new disclosure gate
--    in set_question_flag(). Route all flag mutations through that RPC instead.

DROP POLICY IF EXISTS "Users can update own profile (restricted) or admin full update"
    ON public.profiles;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.profiles
    FROM anon, authenticated;

DROP POLICY IF EXISTS "Active users insert own accessible flags"
    ON public.user_question_flags;

DROP POLICY IF EXISTS "Active users delete own accessible flags"
    ON public.user_question_flags;

REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.user_question_flags
    FROM anon, authenticated;

-- X-audit hardening: deleting an incomplete session must not erase the security
-- history used by burst/daily session-creation limits.
--
-- The user-facing delete flow intentionally remains available because it releases an
-- incomplete block. Security counters now use an immutable session_created event
-- rather than counting the mutable public.test_sessions table.

CREATE INDEX IF NOT EXISTS idx_exam_security_events_user_type_time
    ON private.exam_security_events(user_id, event_type, occurred_at DESC);

-- Preserve the rollout history that still exists in test_sessions. Deleted sessions
-- from before this migration cannot be reconstructed, so enforcement is durable from
-- this cutover forward without retroactively guessing user activity.
INSERT INTO private.exam_security_events(
    user_id,
    event_type,
    question_bank_id,
    session_id,
    occurred_at,
    metadata
)
SELECT
    ts.user_id,
    'session_created',
    ts.question_bank_id,
    ts.id,
    ts.started_at,
    jsonb_build_object('source', 'backfill')
FROM public.test_sessions ts
CROSS JOIN private.exam_security_config cfg
WHERE cfg.singleton = TRUE
  AND ts.started_at >= cfg.policy_started_at
  AND NOT EXISTS (
      SELECT 1
      FROM private.exam_security_events event
      WHERE event.event_type = 'session_created'
        AND event.session_id = ts.id
  );

CREATE OR REPLACE FUNCTION private.enforce_exam_session_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_cfg private.exam_security_config%ROWTYPE;
    v_state private.exam_security_account_state%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_session_24h INTEGER := 0;
    v_session_burst INTEGER := 0;
    v_active INTEGER := 0;
    v_disclosures_24h INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    SELECT * INTO v_cfg
    FROM private.exam_security_config
    WHERE singleton = TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXAM_SECURITY_CONFIG_MISSING';
    END IF;
    IF NOT v_cfg.session_enforcement_enabled THEN
        RETURN NEW;
    END IF;

    IF NOT private.try_exam_security_lock(NEW.user_id) THEN
        RAISE EXCEPTION 'SECURITY_CONCURRENCY_BUSY';
    END IF;

    SELECT * INTO v_state
    FROM private.exam_security_account_state state
    WHERE state.user_id = NEW.user_id;
    IF FOUND THEN
        IF v_state.manual_review_required THEN
            RAISE EXCEPTION 'MANUAL_REVIEW_REQUIRED';
        END IF;
        IF v_state.session_create_blocked_until IS NOT NULL
           AND v_state.session_create_blocked_until > v_now THEN
            RAISE EXCEPTION '%', COALESCE(
                v_state.session_create_block_reason,
                'SESSION_ACCESS_COOLDOWN'
            );
        END IF;
    END IF;

    SELECT count(*) INTO v_disclosures_24h
    FROM (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = NEW.user_id
          AND d.first_disclosed_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - v_cfg.question_daily_window
          )
        ORDER BY d.first_disclosed_at DESC
        LIMIT v_cfg.question_daily_limit
    ) bounded_disclosures;
    IF v_disclosures_24h >= v_cfg.question_daily_limit THEN
        RAISE EXCEPTION 'DAILY_CONTENT_LIMIT';
    END IF;

    SELECT count(*) INTO v_active
    FROM (
        SELECT 1
        FROM private.exam_session_leases lease
        WHERE lease.user_id = NEW.user_id
          AND lease.expires_at > v_now
        LIMIT v_cfg.active_session_limit
    ) active_rows;
    IF v_active >= v_cfg.active_session_limit THEN
        RAISE EXCEPTION 'TOO_MANY_ACTIVE_SESSIONS';
    END IF;

    -- Count immutable creation events. Deleting a test_sessions row sets the event's
    -- session_id FK to NULL, but the event itself and its user/time remain intact.
    SELECT count(*) INTO v_session_24h
    FROM (
        SELECT 1
        FROM private.exam_security_events event
        WHERE event.user_id = NEW.user_id
          AND event.event_type = 'session_created'
          AND event.occurred_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - interval '24 hours'
          )
        ORDER BY event.occurred_at DESC
        LIMIT v_cfg.session_daily_limit
    ) recent_sessions;
    IF v_session_24h >= v_cfg.session_daily_limit THEN
        RAISE EXCEPTION 'DAILY_SESSION_LIMIT';
    END IF;

    SELECT count(*) INTO v_session_burst
    FROM (
        SELECT 1
        FROM private.exam_security_events event
        WHERE event.user_id = NEW.user_id
          AND event.event_type = 'session_created'
          AND event.occurred_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - v_cfg.session_burst_window
          )
        ORDER BY event.occurred_at DESC
        LIMIT v_cfg.session_burst_limit
    ) burst_sessions;
    IF v_session_burst >= v_cfg.session_burst_limit THEN
        RAISE EXCEPTION 'SESSION_BURST_LIMIT';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.after_exam_session_insert_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_cfg private.exam_security_config%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_session_burst INTEGER := 0;
    v_session_24h INTEGER := 0;
    v_block_until TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_cfg
    FROM private.exam_security_config
    WHERE singleton = TRUE;
    IF NOT FOUND OR NOT v_cfg.session_enforcement_enabled THEN
        RETURN NEW;
    END IF;

    -- Persist the creation before any mutable public session row can be deleted.
    INSERT INTO private.exam_security_events(
        user_id,
        event_type,
        question_bank_id,
        session_id,
        occurred_at,
        metadata
    ) VALUES (
        NEW.user_id,
        'session_created',
        NEW.question_bank_id,
        NEW.id,
        v_now,
        jsonb_build_object('source', 'session_insert')
    );

    INSERT INTO private.exam_session_leases(session_id,user_id,expires_at,updated_at)
    VALUES (NEW.id,NEW.user_id,v_now+v_cfg.active_session_lease,v_now)
    ON CONFLICT (session_id) DO UPDATE
    SET user_id=EXCLUDED.user_id,
        expires_at=EXCLUDED.expires_at,
        updated_at=EXCLUDED.updated_at;

    SELECT count(*) INTO v_session_burst
    FROM (
        SELECT 1
        FROM private.exam_security_events event
        WHERE event.user_id = NEW.user_id
          AND event.event_type = 'session_created'
          AND event.occurred_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - v_cfg.session_burst_window
          )
        ORDER BY event.occurred_at DESC
        LIMIT v_cfg.session_burst_limit
    ) burst_sessions;

    IF v_session_burst >= v_cfg.session_burst_limit THEN
        v_block_until := v_now + v_cfg.session_burst_block;
        INSERT INTO private.exam_security_account_state(
            user_id,
            session_create_blocked_until,
            session_create_block_reason,
            risk_score,
            updated_at
        ) VALUES (
            NEW.user_id,
            v_block_until,
            'SESSION_BURST_LIMIT',
            5,
            v_now
        )
        ON CONFLICT (user_id) DO UPDATE SET
            session_create_block_reason = CASE
                WHEN exam_security_account_state.session_create_blocked_until IS NULL
                     OR exam_security_account_state.session_create_blocked_until < EXCLUDED.session_create_blocked_until
                    THEN EXCLUDED.session_create_block_reason
                ELSE exam_security_account_state.session_create_block_reason
            END,
            session_create_blocked_until = GREATEST(
                COALESCE(exam_security_account_state.session_create_blocked_until,'-infinity'::timestamptz),
                EXCLUDED.session_create_blocked_until
            ),
            risk_score = LEAST(100,exam_security_account_state.risk_score+5),
            updated_at = v_now;

        INSERT INTO private.exam_security_events(
            user_id,event_type,question_bank_id,session_id,metadata
        ) VALUES (
            NEW.user_id,
            'session_burst_limit_reached',
            NEW.question_bank_id,
            NEW.id,
            jsonb_build_object('limit',v_cfg.session_burst_limit)
        );
    END IF;

    SELECT count(*) INTO v_session_24h
    FROM (
        SELECT 1
        FROM private.exam_security_events event
        WHERE event.user_id = NEW.user_id
          AND event.event_type = 'session_created'
          AND event.occurred_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - interval '24 hours'
          )
        ORDER BY event.occurred_at DESC
        LIMIT v_cfg.session_daily_limit
    ) recent_sessions;

    IF v_session_24h >= v_cfg.session_daily_limit THEN
        INSERT INTO private.exam_security_events(
            user_id,event_type,question_bank_id,session_id,metadata
        ) VALUES (
            NEW.user_id,
            'session_daily_cap_reached',
            NEW.question_bank_id,
            NEW.id,
            jsonb_build_object('limit',v_cfg.session_daily_limit)
        );
    END IF;

    RETURN NEW;
END;
$$;

-- X-audit hardening: do not use a custom PostgreSQL GUC as proof that a NULL
-- answer came from trusted timed-session finalization. A security decision must not
-- depend on client-controllable session state.
--
-- The trusted completion function now writes an uncommitted marker into a private,
-- non-API table. The answer trigger can see that marker only inside the same
-- transaction. Browser roles have neither schema access nor table privileges.

CREATE TABLE private.exam_timed_finalization_context (
    transaction_id BIGINT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (transaction_id, user_id, session_id)
);

ALTER TABLE private.exam_timed_finalization_context ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.exam_timed_finalization_context
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    option_is_correct BOOLEAN;
    session_mode TEXT;
    trusted_timed_finalization BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Answer user does not match authenticated user';
    END IF;

    SELECT ts.session_type
    INTO session_mode
    FROM public.test_sessions ts
    WHERE ts.id = NEW.test_session_id
      AND ts.user_id = NEW.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    -- Check locked-session membership before inspecting disclosure or option data.
    IF to_regclass('public.test_session_questions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM public.test_session_questions tsq
            WHERE tsq.test_session_id = NEW.test_session_id
              AND tsq.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    trusted_timed_finalization :=
        session_mode IN ('timed', 'fixed_timed')
        AND EXISTS (
            SELECT 1
            FROM private.exam_timed_finalization_context ctx
            WHERE ctx.transaction_id = txid_current()
              AND ctx.user_id = NEW.user_id
              AND ctx.session_id = NEW.test_session_id
        );

    IF NEW.selected_option_id IS NULL THEN
        IF NOT trusted_timed_finalization THEN
            RAISE EXCEPTION 'Submitted answer requires a selected option';
        END IF;
        NEW.is_correct := FALSE;
    ELSE
        -- Preserve migration 017's disclosure gate: selected answers are accepted
        -- only for content that this user has actually received.
        IF NOT EXISTS (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = NEW.user_id
              AND d.question_id = NEW.question_id
        ) THEN
            RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
        END IF;

        SELECT o.is_correct
        INTO option_is_correct
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected option does not belong to question';
        END IF;

        NEW.is_correct := option_is_correct;
    END IF;

    RETURN NEW;
END;
$$;
