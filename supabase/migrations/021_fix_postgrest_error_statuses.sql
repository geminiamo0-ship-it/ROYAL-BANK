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
