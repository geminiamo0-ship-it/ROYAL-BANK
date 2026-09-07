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

CREATE OR REPLACE FUNCTION private.release_completed_exam_session_lease()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NEW.is_completed IS TRUE AND OLD.is_completed IS DISTINCT FROM TRUE THEN
        DELETE FROM private.exam_session_leases
        WHERE session_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z0_release_completed_exam_session_lease_trigger ON public.test_sessions;
CREATE TRIGGER z0_release_completed_exam_session_lease_trigger
AFTER UPDATE OF is_completed ON public.test_sessions
FOR EACH ROW
EXECUTE FUNCTION private.release_completed_exam_session_lease();

CREATE OR REPLACE FUNCTION private.authorize_and_record_question_window(
    p_user_id UUID,
    p_bank_id BIGINT,
    p_session_id UUID,
    p_start INTEGER,
    p_count INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_cfg private.exam_security_config%ROWTYPE;
    v_state private.exam_security_account_state%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_candidate_count INTEGER := 0;
    v_requested_first_new INTEGER;
    v_frontier INTEGER;
    v_count_15m INTEGER := 0;
    v_count_24h INTEGER := 0;
    v_new_budget INTEGER := 0;
    v_new_accepted INTEGER := 0;
    v_effective_count INTEGER := 0;
    v_inserted INTEGER := 0;
    v_after_15m INTEGER := 0;
    v_after_24h INTEGER := 0;
    v_block_code TEXT;
    v_block_until TIMESTAMPTZ;
    v_today_cairo DATE;
    v_last_cap_date DATE;
    v_previous_streak INTEGER := 0;
    v_new_streak INTEGER := 1;
    v_row RECORD;
BEGIN
    IF p_user_id IS NULL OR p_session_id IS NULL OR p_bank_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_EXAM_SECURITY_CONTEXT';
    END IF;

    IF p_start IS NULL OR p_start < 0 OR p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'INVALID_QUESTION_WINDOW';
    END IF;

    SELECT * INTO v_cfg
    FROM private.exam_security_config
    WHERE singleton = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXAM_SECURITY_CONFIG_MISSING';
    END IF;

    IF NOT private.try_exam_security_lock(p_user_id) THEN
        RAISE EXCEPTION 'SECURITY_CONCURRENCY_BUSY';
    END IF;

    PERFORM private.touch_exam_session_lease(p_user_id, p_session_id, v_now);

    SELECT
        count(*)::integer,
        MIN(tsq.sort_order) FILTER (WHERE d.question_id IS NULL)
    INTO v_candidate_count, v_requested_first_new
    FROM public.test_session_questions tsq
    LEFT JOIN private.question_disclosures d
      ON d.user_id = p_user_id
     AND d.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + p_count;

    IF v_candidate_count = 0 THEN
        RETURN 0;
    END IF;

    IF NOT v_cfg.question_enforcement_enabled THEN
        RETURN p_count;
    END IF;

    -- Requests containing only content already disclosed to this user remain usable
    -- even during cooldown/manual-review states.
    IF v_requested_first_new IS NULL THEN
        RETURN p_count;
    END IF;

    SELECT MIN(tsq.sort_order)
    INTO v_frontier
    FROM public.test_session_questions tsq
    LEFT JOIN private.question_disclosures d
      ON d.user_id = p_user_id
     AND d.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND d.question_id IS NULL;

    IF v_frontier IS NULL OR v_requested_first_new <> v_frontier THEN
        RAISE EXCEPTION 'QUESTION_WINDOW_OUT_OF_SEQUENCE';
    END IF;

    SELECT * INTO v_state
    FROM private.exam_security_account_state state
    WHERE state.user_id = p_user_id;

    IF FOUND AND v_state.manual_review_required THEN
        v_new_budget := 0;
        v_block_code := 'MANUAL_REVIEW_REQUIRED';
    ELSIF FOUND
       AND v_state.question_blocked_until IS NOT NULL
       AND v_state.question_blocked_until > v_now THEN
        v_new_budget := 0;
        v_block_code := COALESCE(v_state.question_block_reason, 'QUESTION_ACCESS_COOLDOWN');
    ELSE
        SELECT count(*) INTO v_count_15m
        FROM (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = p_user_id
              AND d.first_disclosed_at >= GREATEST(
                  v_cfg.policy_started_at,
                  v_now - v_cfg.question_burst_window
              )
            ORDER BY d.first_disclosed_at DESC
            LIMIT v_cfg.question_burst_limit
        ) bounded_burst;

        SELECT count(*) INTO v_count_24h
        FROM (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = p_user_id
              AND d.first_disclosed_at >= GREATEST(
                  v_cfg.policy_started_at,
                  v_now - v_cfg.question_daily_window
              )
            ORDER BY d.first_disclosed_at DESC
            LIMIT v_cfg.question_daily_limit
        ) bounded_daily;

        v_new_budget := LEAST(
            v_cfg.max_new_questions_per_window,
            GREATEST(v_cfg.question_daily_limit - v_count_24h, 0)
        );

        IF v_count_24h >= v_cfg.question_daily_limit THEN
            v_new_budget := 0;
            v_block_code := 'DAILY_CONTENT_LIMIT';
        END IF;

        IF v_count_15m >= v_cfg.question_burst_limit THEN
            v_new_budget := 0;
            v_block_code := COALESCE(v_block_code, 'QUESTION_ACCESS_COOLDOWN');
        ELSE
            v_new_budget := LEAST(
                v_new_budget,
                v_cfg.question_burst_limit - v_count_15m
            );
        END IF;

        -- 300 is a one-time crossing cooldown while the rolling count remains above
        -- 300. Once the 3h cooldown expires, the user may continue toward 650.
        IF v_count_24h < v_cfg.question_soft_limit THEN
            v_new_budget := LEAST(
                v_new_budget,
                v_cfg.question_soft_limit - v_count_24h
            );
        END IF;
    END IF;

    -- Return the largest PREFIX of the requested range that does not disclose more
    -- fresh questions than the current budget. This prevents 59 -> 62, 299 -> 302,
    -- or 649 -> 652 overshoots while still returning any already-disclosed prefix.
    FOR v_row IN
        SELECT
            tsq.sort_order,
            tsq.question_id,
            (d.question_id IS NULL) AS is_new
        FROM public.test_session_questions tsq
        LEFT JOIN private.question_disclosures d
          ON d.user_id = p_user_id
         AND d.question_id = tsq.question_id
        WHERE tsq.test_session_id = p_session_id
          AND tsq.sort_order >= p_start
          AND tsq.sort_order < p_start + p_count
        ORDER BY tsq.sort_order
    LOOP
        IF v_row.is_new THEN
            IF v_new_accepted >= v_new_budget THEN
                EXIT;
            END IF;
            v_new_accepted := v_new_accepted + 1;
        END IF;

        -- Core windowing is expressed as a sort-order span, not row count.
        v_effective_count := v_row.sort_order - p_start + 1;
    END LOOP;

    IF v_effective_count <= 0 THEN
        RAISE EXCEPTION '%', COALESCE(v_block_code, 'QUESTION_ACCESS_COOLDOWN');
    END IF;

    INSERT INTO private.question_disclosures(
        user_id,
        question_id,
        first_bank_id,
        first_session_id,
        first_disclosed_at
    )
    SELECT
        p_user_id,
        tsq.question_id,
        p_bank_id,
        p_session_id,
        v_now
    FROM public.test_session_questions tsq
    LEFT JOIN private.question_disclosures d
      ON d.user_id = p_user_id
     AND d.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + v_effective_count
      AND d.question_id IS NULL
    ORDER BY tsq.sort_order
    ON CONFLICT (user_id, question_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted > 0 THEN
        v_after_15m := v_count_15m + v_inserted;
        v_after_24h := v_count_24h + v_inserted;

        IF v_count_15m < v_cfg.question_burst_limit
           AND v_after_15m >= v_cfg.question_burst_limit THEN
            v_block_until := v_now + v_cfg.question_burst_block;

            INSERT INTO private.exam_security_account_state(
                user_id,
                question_blocked_until,
                question_block_reason,
                risk_score,
                updated_at
            ) VALUES (
                p_user_id,
                v_block_until,
                'QUESTION_ACCESS_COOLDOWN',
                5,
                v_now
            )
            ON CONFLICT (user_id) DO UPDATE
            SET
                question_block_reason = CASE
                    WHEN exam_security_account_state.question_blocked_until IS NULL
                      OR exam_security_account_state.question_blocked_until < EXCLUDED.question_blocked_until
                    THEN EXCLUDED.question_block_reason
                    ELSE exam_security_account_state.question_block_reason
                END,
                question_blocked_until = GREATEST(
                    COALESCE(exam_security_account_state.question_blocked_until, '-infinity'::timestamptz),
                    EXCLUDED.question_blocked_until
                ),
                risk_score = LEAST(100, exam_security_account_state.risk_score + 5),
                updated_at = v_now;

            INSERT INTO private.exam_security_events(
                user_id, event_type, question_bank_id, session_id, metadata
            ) VALUES (
                p_user_id,
                'question_burst_limit_reached',
                p_bank_id,
                p_session_id,
                jsonb_build_object('limit', v_cfg.question_burst_limit)
            );
        END IF;

        IF v_count_24h < v_cfg.question_soft_limit
           AND v_after_24h >= v_cfg.question_soft_limit THEN
            v_block_until := v_now + v_cfg.question_soft_block;

            INSERT INTO private.exam_security_account_state(
                user_id,
                question_blocked_until,
                question_block_reason,
                session_create_blocked_until,
                session_create_block_reason,
                risk_score,
                updated_at
            ) VALUES (
                p_user_id,
                v_block_until,
                'QUESTION_ACCESS_COOLDOWN',
                v_block_until,
                'QUESTION_ACCESS_COOLDOWN',
                20,
                v_now
            )
            ON CONFLICT (user_id) DO UPDATE
            SET
                question_block_reason = CASE
                    WHEN exam_security_account_state.question_blocked_until IS NULL
                      OR exam_security_account_state.question_blocked_until < EXCLUDED.question_blocked_until
                    THEN EXCLUDED.question_block_reason
                    ELSE exam_security_account_state.question_block_reason
                END,
                question_blocked_until = GREATEST(
                    COALESCE(exam_security_account_state.question_blocked_until, '-infinity'::timestamptz),
                    EXCLUDED.question_blocked_until
                ),
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
                risk_score = LEAST(100, exam_security_account_state.risk_score + 20),
                updated_at = v_now;

            INSERT INTO private.exam_security_events(
                user_id, event_type, question_bank_id, session_id, metadata
            ) VALUES (
                p_user_id,
                'question_300_cooldown_reached',
                p_bank_id,
                p_session_id,
                jsonb_build_object('limit', v_cfg.question_soft_limit)
            );
        END IF;

        IF v_count_24h < v_cfg.question_daily_limit
           AND v_after_24h >= v_cfg.question_daily_limit THEN
            v_today_cairo := (v_now AT TIME ZONE 'Africa/Cairo')::date;

            SELECT
                state.last_question_cap_cairo_date,
                state.consecutive_question_cap_days
            INTO v_last_cap_date, v_previous_streak
            FROM private.exam_security_account_state state
            WHERE state.user_id = p_user_id;

            IF v_last_cap_date IS DISTINCT FROM v_today_cairo THEN
                IF v_last_cap_date = v_today_cairo - 1 THEN
                    v_new_streak := COALESCE(v_previous_streak, 0) + 1;
                ELSE
                    v_new_streak := 1;
                END IF;

                INSERT INTO private.exam_security_account_state(
                    user_id,
                    last_question_cap_cairo_date,
                    consecutive_question_cap_days,
                    risk_score,
                    updated_at
                ) VALUES (
                    p_user_id,
                    v_today_cairo,
                    v_new_streak,
                    50,
                    v_now
                )
                ON CONFLICT (user_id) DO UPDATE
                SET
                    last_question_cap_cairo_date = EXCLUDED.last_question_cap_cairo_date,
                    consecutive_question_cap_days = EXCLUDED.consecutive_question_cap_days,
                    risk_score = LEAST(100, exam_security_account_state.risk_score + 50),
                    updated_at = v_now;

                INSERT INTO private.exam_security_events(
                    user_id, event_type, question_bank_id, session_id, metadata
                ) VALUES (
                    p_user_id,
                    'question_daily_cap_reached',
                    p_bank_id,
                    p_session_id,
                    jsonb_build_object(
                        'limit', v_cfg.question_daily_limit,
                        'cairo_date', v_today_cairo,
                        'consecutive_days', v_new_streak
                    )
                );

                IF v_new_streak >= 2 THEN
                    UPDATE private.exam_security_account_state
                    SET
                        manual_review_required = TRUE,
                        manual_review_reason = 'REPEATED_DAILY_CONTENT_LIMIT',
                        updated_at = v_now
                    WHERE user_id = p_user_id;

                    INSERT INTO private.exam_security_events(
                        user_id, event_type, question_bank_id, session_id, metadata
                    ) VALUES (
                        p_user_id,
                        'manual_review_lock',
                        p_bank_id,
                        p_session_id,
                        jsonb_build_object('reason', 'REPEATED_DAILY_CONTENT_LIMIT')
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN v_effective_count;
END;
$$;

-- Keep the proven safe-payload implementation unchanged by moving it behind a
-- security wrapper rather than rewriting its answer-secrecy query.
ALTER FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    SET SCHEMA private;
ALTER FUNCTION private.get_exam_session_window(UUID, INTEGER, INTEGER)
    RENAME TO get_exam_session_window_core;
REVOKE ALL ON FUNCTION private.get_exam_session_window_core(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_exam_session_window(
    p_session_id UUID,
    p_start INTEGER DEFAULT 0,
    p_count INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_session public.test_sessions;
    v_effective_count INTEGER;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;

    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = v_user_id;

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;

    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    v_effective_count := private.authorize_and_record_question_window(
        v_user_id,
        v_session.question_bank_id,
        p_session_id,
        p_start,
        p_count
    );

    IF v_effective_count <= 0 THEN
        RETURN '[]'::jsonb;
    END IF;

    -- Core performs its original fresh auth/ownership/access checks again before
    -- reading content. Do not collapse this boundary into the earlier checks.
    RETURN private.get_exam_session_window_core(
        p_session_id,
        p_start,
        v_effective_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    TO authenticated;

-- get_exam_session_bootstrap now calls a VOLATILE window wrapper that records
-- disclosures, so its volatility must permit writes.
ALTER FUNCTION public.get_exam_session_bootstrap(UUID) VOLATILE;

-- Preserve the heavily-tested inline create implementation as an internal core.
ALTER FUNCTION public.create_exam_session_bootstrap(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) SET SCHEMA private;
ALTER FUNCTION private.create_exam_session_bootstrap(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) RENAME TO create_exam_session_bootstrap_core;
REVOKE ALL ON FUNCTION private.create_exam_session_bootstrap_core(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_exam_session_bootstrap(
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INTEGER,
    p_difficulties TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_topics JSONB DEFAULT '[]'::JSONB,
    p_question_selection TEXT DEFAULT 'new_only'::TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_payload JSONB;
    v_user_id UUID;
    v_session_id UUID;
    v_bank_id BIGINT;
    v_current_index INTEGER;
BEGIN
    v_payload := private.create_exam_session_bootstrap_core(
        p_bank_id,
        p_session_type,
        p_limit,
        p_difficulties,
        p_categories,
        p_topics,
        p_question_selection
    );

    IF COALESCE(v_payload->>'status', '') <> 'active'
       OR jsonb_array_length(COALESCE(v_payload->'questions', '[]'::jsonb)) = 0 THEN
        RETURN v_payload;
    END IF;

    -- Fresh post-core boundary. The internal core already preserves both original
    -- post-insert checks; this additional check ensures no security result from the
    -- beginning of the transaction is reused for disclosure authorization.
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    v_session_id := (v_payload->'session'->>'id')::uuid;
    v_bank_id := (v_payload->'session'->>'question_bank_id')::bigint;
    v_current_index := COALESCE((v_payload->>'current_index')::integer, 0);

    IF NOT public.can_access_question_bank(v_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    PERFORM private.authorize_and_record_question_window(
        v_user_id,
        v_bank_id,
        v_session_id,
        v_current_index,
        1
    );

    RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_session_bootstrap(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam_session_bootstrap(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

-- Idempotent create is a separate RPC name so the existing 7-argument function keeps
-- an unambiguous PostgREST signature. The gateway/client should use this function.
CREATE OR REPLACE FUNCTION public.create_exam_session_bootstrap_idempotent(
    p_request_id UUID,
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INTEGER,
    p_difficulties TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_topics JSONB DEFAULT '[]'::JSONB,
    p_question_selection TEXT DEFAULT 'new_only'::TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_request_payload JSONB;
    v_existing private.exam_create_idempotency%ROWTYPE;
    v_response JSONB;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    IF NOT pg_try_advisory_xact_lock(
        hashtextextended(
            'royal:exam-idempotency:' || v_user_id::text || ':' || p_request_id::text,
            0
        )
    ) THEN
        RAISE EXCEPTION 'SECURITY_CONCURRENCY_BUSY';
    END IF;

    v_request_payload := jsonb_build_object(
        'bank_id', p_bank_id,
        'session_type', p_session_type,
        'limit', p_limit,
        'difficulties', COALESCE(to_jsonb(p_difficulties), '[]'::jsonb),
        'categories', COALESCE(to_jsonb(p_categories), '[]'::jsonb),
        'topics', COALESCE(p_topics, '[]'::jsonb),
        'question_selection', p_question_selection
    );

    SELECT * INTO v_existing
    FROM private.exam_create_idempotency idem
    WHERE idem.user_id = v_user_id
      AND idem.request_id = p_request_id;

    IF FOUND THEN
        IF v_existing.request_payload IS DISTINCT FROM v_request_payload THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
        END IF;

        RETURN v_existing.response_payload;
    END IF;

    v_response := public.create_exam_session_bootstrap(
        p_bank_id,
        p_session_type,
        p_limit,
        p_difficulties,
        p_categories,
        p_topics,
        p_question_selection
    );

    INSERT INTO private.exam_create_idempotency(
        user_id, request_id, request_payload, response_payload
    ) VALUES (
        v_user_id, p_request_id, v_request_payload, v_response
    );

    RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_session_bootstrap_idempotent(
    UUID, BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam_session_bootstrap_idempotent(
    UUID, BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
