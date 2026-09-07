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
