SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

REVOKE ALL ON FUNCTION public.create_exam_session_bootstrap(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_exam_session_bootstrap(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Keep exam answer state writes behind the audited RPC boundary.
--
-- The application submits answers through SECURITY DEFINER RPCs that enforce
-- authentication, ownership, bank access, session membership, answer finality,
-- and server-derived correctness. Direct table writes are unnecessary and widen
-- the attack surface (including any future misuse of transaction-local state
-- used by trusted finalization code).
--
-- Preserve existing SELECT semantics for answer-history tests/flows. Only direct
-- mutation and table-management privileges are removed. SECURITY DEFINER RPCs
-- continue to work because they execute with the function owner's privileges.
-- service_role/postgres privileges are intentionally left unchanged.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLE public.user_answers
FROM anon, authenticated;

-- Royal exam anti-scraping / abuse guardrails.
--
-- Security goals:
-- 1. Bound creation of new exam sessions without changing existing trial-quota semantics.
-- 2. Count disclosure of NEW unique question content, not repeated views.
-- 3. Prevent fresh-content window jumping and concurrent quota races.
-- 4. Keep already-disclosed content, answer submission, feedback, and completion available.
-- 5. Fail fast on security-lock contention; never sleep while holding a database worker.
--
-- NOTE: request-rate limiting (20 window/min, 20 submit/min, etc.) belongs at the
-- Vercel gateway/edge. This migration deliberately does not write one counter row per
-- request because doing so would amplify an application-layer DoS.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.exam_security_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    policy_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    session_enforcement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    question_enforcement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    session_daily_limit INTEGER NOT NULL DEFAULT 14 CHECK (session_daily_limit > 0),
    session_burst_limit INTEGER NOT NULL DEFAULT 4 CHECK (session_burst_limit > 0),
    session_burst_window INTERVAL NOT NULL DEFAULT interval '10 minutes',
    session_burst_block INTERVAL NOT NULL DEFAULT interval '30 minutes',
    active_session_limit INTEGER NOT NULL DEFAULT 3 CHECK (active_session_limit > 0),
    active_session_lease INTERVAL NOT NULL DEFAULT interval '30 minutes',
    question_burst_limit INTEGER NOT NULL DEFAULT 60 CHECK (question_burst_limit > 0),
    question_burst_window INTERVAL NOT NULL DEFAULT interval '15 minutes',
    question_burst_block INTERVAL NOT NULL DEFAULT interval '30 minutes',
    question_soft_limit INTEGER NOT NULL DEFAULT 300 CHECK (question_soft_limit > 0),
    question_soft_window INTERVAL NOT NULL DEFAULT interval '24 hours',
    question_soft_block INTERVAL NOT NULL DEFAULT interval '3 hours',
    question_daily_limit INTEGER NOT NULL DEFAULT 650 CHECK (question_daily_limit > 0),
    question_daily_window INTERVAL NOT NULL DEFAULT interval '24 hours',
    max_new_questions_per_window INTEGER NOT NULL DEFAULT 3
        CHECK (max_new_questions_per_window BETWEEN 1 AND 5),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO private.exam_security_config(singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE private.exam_security_account_state (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    question_blocked_until TIMESTAMPTZ,
    question_block_reason TEXT,
    session_create_blocked_until TIMESTAMPTZ,
    session_create_block_reason TEXT,
    manual_review_required BOOLEAN NOT NULL DEFAULT FALSE,
    manual_review_reason TEXT,
    risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0),
    last_question_cap_cairo_date DATE,
    consecutive_question_cap_days INTEGER NOT NULL DEFAULT 0
        CHECK (consecutive_question_cap_days >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.question_disclosures (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    first_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE SET NULL,
    first_session_id UUID REFERENCES public.test_sessions(id) ON DELETE SET NULL,
    first_disclosed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    first_ip_hmac TEXT,
    first_user_agent_hmac TEXT,
    PRIMARY KEY (user_id, question_id)
);

CREATE INDEX idx_question_disclosures_user_time
    ON private.question_disclosures(user_id, first_disclosed_at DESC);

CREATE INDEX idx_question_disclosures_user_bank_time
    ON private.question_disclosures(user_id, first_bank_id, first_disclosed_at DESC);

-- A previously answered question was necessarily disclosed in the past. Backfill it
-- with its original answer time so revisiting it is not charged as NEW content. The
-- policy_started_at cutover means historical rows do not immediately consume the new
-- 15-minute / 24-hour quotas during rollout.
INSERT INTO private.question_disclosures (
    user_id,
    question_id,
    first_bank_id,
    first_session_id,
    first_disclosed_at
)
SELECT DISTINCT ON (ua.user_id, ua.question_id)
    ua.user_id,
    ua.question_id,
    ts.question_bank_id,
    ua.test_session_id,
    ua.answered_at
FROM public.user_answers ua
JOIN public.test_sessions ts ON ts.id = ua.test_session_id
WHERE ua.answered_at IS NOT NULL
ORDER BY ua.user_id, ua.question_id, ua.answered_at, ua.id
ON CONFLICT (user_id, question_id) DO NOTHING;

CREATE TABLE private.exam_session_leases (
    session_id UUID PRIMARY KEY REFERENCES public.test_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_exam_session_leases_user_expiry
    ON private.exam_session_leases(user_id, expires_at DESC);

CREATE TABLE private.exam_security_events (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE SET NULL,
    session_id UUID REFERENCES public.test_sessions(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_exam_security_events_user_time
    ON private.exam_security_events(user_id, occurred_at DESC);

CREATE INDEX idx_exam_security_events_type_time
    ON private.exam_security_events(event_type, occurred_at DESC);

CREATE TABLE private.exam_create_idempotency (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    request_payload JSONB NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, request_id)
);

CREATE INDEX idx_exam_create_idempotency_created
    ON private.exam_create_idempotency(created_at DESC);

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.try_exam_security_lock(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, private, public, pg_temp
AS $$
    SELECT pg_try_advisory_xact_lock(
        hashtextextended('royal:exam-security:' || p_user_id::text, 0)
    );
$$;

CREATE OR REPLACE FUNCTION private.touch_exam_session_lease(
    p_user_id UUID,
    p_session_id UUID,
    p_now TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_cfg private.exam_security_config%ROWTYPE;
    v_current_active BOOLEAN := FALSE;
    v_other_active INTEGER := 0;
BEGIN
    SELECT * INTO v_cfg
    FROM private.exam_security_config
    WHERE singleton = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXAM_SECURITY_CONFIG_MISSING';
    END IF;

    IF NOT v_cfg.session_enforcement_enabled THEN
        RETURN;
    END IF;

    SELECT lease.expires_at > p_now
    INTO v_current_active
    FROM private.exam_session_leases lease
    WHERE lease.session_id = p_session_id
      AND lease.user_id = p_user_id;

    IF NOT COALESCE(v_current_active, FALSE) THEN
        SELECT count(*)
        INTO v_other_active
        FROM (
            SELECT 1
            FROM private.exam_session_leases lease
            WHERE lease.user_id = p_user_id
              AND lease.session_id <> p_session_id
              AND lease.expires_at > p_now
            LIMIT v_cfg.active_session_limit
        ) active_rows;

        IF v_other_active >= v_cfg.active_session_limit THEN
            RAISE EXCEPTION 'TOO_MANY_ACTIVE_SESSIONS';
        END IF;
    END IF;

    INSERT INTO private.exam_session_leases(session_id, user_id, expires_at, updated_at)
    VALUES (
        p_session_id,
        p_user_id,
        p_now + v_cfg.active_session_lease,
        p_now
    )
    ON CONFLICT (session_id) DO UPDATE
    SET
        user_id = EXCLUDED.user_id,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at;
END;
$$;

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

    -- This lock is intentionally acquired before the existing free-trial
    -- user+bank lock. Trigger name a0_* keeps the lock order deterministic.
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
            RAISE EXCEPTION '%', COALESCE(v_state.session_create_block_reason, 'SESSION_ACCESS_COOLDOWN');
        END IF;
    END IF;

    -- A hard 650-question rolling cap also prevents creation of sessions that
    -- could be used to probe for fresh content.
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

    SELECT count(*) INTO v_session_24h
    FROM (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.user_id = NEW.user_id
          AND ts.started_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - interval '24 hours'
          )
        ORDER BY ts.started_at DESC
        LIMIT v_cfg.session_daily_limit
    ) recent_sessions;

    IF v_session_24h >= v_cfg.session_daily_limit THEN
        RAISE EXCEPTION 'DAILY_SESSION_LIMIT';
    END IF;

    SELECT count(*) INTO v_session_burst
    FROM (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.user_id = NEW.user_id
          AND ts.started_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - v_cfg.session_burst_window
          )
        ORDER BY ts.started_at DESC
        LIMIT v_cfg.session_burst_limit
    ) burst_sessions;

    IF v_session_burst >= v_cfg.session_burst_limit THEN
        RAISE EXCEPTION 'SESSION_BURST_LIMIT';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a0_enforce_exam_session_security_trigger ON public.test_sessions;

CREATE TRIGGER a0_enforce_exam_session_security_trigger
BEFORE INSERT ON public.test_sessions
FOR EACH ROW
EXECUTE FUNCTION private.enforce_exam_session_security();

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

    INSERT INTO private.exam_session_leases(session_id, user_id, expires_at, updated_at)
    VALUES (NEW.id, NEW.user_id, v_now + v_cfg.active_session_lease, v_now)
    ON CONFLICT (session_id) DO UPDATE
    SET
        user_id = EXCLUDED.user_id,
        expires_at = EXCLUDED.expires_at,
        updated_at = EXCLUDED.updated_at;

    SELECT count(*) INTO v_session_burst
    FROM (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.user_id = NEW.user_id
          AND ts.started_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - v_cfg.session_burst_window
          )
        ORDER BY ts.started_at DESC
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
        ON CONFLICT (user_id) DO UPDATE
        SET
            session_create_block_reason = CASE
                WHEN exam_security_account_state.session_create_blocked_until IS NULL
                  OR exam_security_account_state.session_create_blocked_until < EXCLUDED.session_create_blocked_until
                THEN EXCLUDED.session_create_block_reason
                ELSE exam_security_account_state.session_create_block_reason
            END,
            session_create_blocked_until = GREATEST(
                COALESCE(exam_security_account_state.session_create_blocked_until, '-infinity'::timestamptz),
                EXCLUDED.session_create_blocked_until
            ),
            risk_score = LEAST(100, exam_security_account_state.risk_score + 5),
            updated_at = v_now;

        INSERT INTO private.exam_security_events(
            user_id, event_type, question_bank_id, session_id, metadata
        ) VALUES (
            NEW.user_id,
            'session_burst_limit_reached',
            NEW.question_bank_id,
            NEW.id,
            jsonb_build_object('limit', v_cfg.session_burst_limit)
        );
    END IF;

    SELECT count(*) INTO v_session_24h
    FROM (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.user_id = NEW.user_id
          AND ts.started_at >= GREATEST(
              v_cfg.policy_started_at,
              v_now - interval '24 hours'
          )
        ORDER BY ts.started_at DESC
        LIMIT v_cfg.session_daily_limit
    ) recent_sessions;

    IF v_session_24h >= v_cfg.session_daily_limit THEN
        INSERT INTO private.exam_security_events(
            user_id, event_type, question_bank_id, session_id, metadata
        ) VALUES (
            NEW.user_id,
            'session_daily_cap_reached',
            NEW.question_bank_id,
            NEW.id,
            jsonb_build_object('limit', v_cfg.session_daily_limit)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z0_after_exam_session_insert_security_trigger ON public.test_sessions;

CREATE TRIGGER z0_after_exam_session_insert_security_trigger
AFTER INSERT ON public.test_sessions
FOR EACH ROW
EXECUTE FUNCTION private.after_exam_session_insert_security();
