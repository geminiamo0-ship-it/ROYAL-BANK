-- Add bounded account-state counters for gateway request-rate-limit escalation.
--
-- N (request counting) stays at Vercel so normal traffic does not add a database
-- round trip or write per request. This migration implements O: only requests that
-- Vercel already rejected with 429 are recorded here. Repeated rejections escalate
-- a scoped NEW-content/session-create cooldown while preserving answer submission,
-- earned feedback, review, completion, and existing progress.

ALTER TABLE private.exam_security_config
    ADD COLUMN IF NOT EXISTS gateway_abuse_escalation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS gateway_reject_threshold INTEGER NOT NULL DEFAULT 10
        CHECK (gateway_reject_threshold > 0),
    ADD COLUMN IF NOT EXISTS gateway_reject_window INTERVAL NOT NULL DEFAULT interval '10 minutes'
        CHECK (gateway_reject_window > interval '0 seconds'),
    ADD COLUMN IF NOT EXISTS gateway_first_block INTERVAL NOT NULL DEFAULT interval '15 minutes'
        CHECK (gateway_first_block > interval '0 seconds'),
    ADD COLUMN IF NOT EXISTS gateway_second_block INTERVAL NOT NULL DEFAULT interval '1 hour'
        CHECK (gateway_second_block > interval '0 seconds'),
    ADD COLUMN IF NOT EXISTS gateway_third_block INTERVAL NOT NULL DEFAULT interval '3 hours'
        CHECK (gateway_third_block > interval '0 seconds'),
    ADD COLUMN IF NOT EXISTS gateway_escalation_window INTERVAL NOT NULL DEFAULT interval '24 hours'
        CHECK (gateway_escalation_window > interval '0 seconds'),
    ADD COLUMN IF NOT EXISTS gateway_high_risk_score INTEGER NOT NULL DEFAULT 75
        CHECK (gateway_high_risk_score >= 0);

ALTER TABLE private.exam_security_account_state
    ADD COLUMN IF NOT EXISTS gateway_reject_count INTEGER NOT NULL DEFAULT 0
        CHECK (gateway_reject_count >= 0),
    ADD COLUMN IF NOT EXISTS gateway_reject_window_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gateway_escalation_count INTEGER NOT NULL DEFAULT 0
        CHECK (gateway_escalation_count >= 0),
    ADD COLUMN IF NOT EXISTS gateway_escalation_window_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gateway_last_rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gateway_last_escalated_at TIMESTAMPTZ;

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
