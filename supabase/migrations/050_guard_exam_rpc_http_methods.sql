-- Protected exam RPCs are intentionally callable only through the Royal BFF, which
-- always uses POST. Reject alternate PostgREST invocation methods so read-only RPCs
-- cannot bypass gateway proof/rate limiting via GET or HEAD.

CREATE OR REPLACE FUNCTION api_hooks.royal_exam_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
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

    IF v_rpc_name IS NULL
       OR v_rpc_name <> ALL (ARRAY[
            'create_exam_session_bootstrap',
            'create_exam_session_bootstrap_idempotent',
            'get_exam_session_bootstrap',
            'get_exam_session_window',
            'get_completed_exam_review_bootstrap',
            'get_completed_exam_review_window',
            'get_completed_exam_review_feedback',
            'submit_exam_answer_with_feedback',
            'submit_exam_answer',
            'get_exam_question_feedback',
            'set_question_flag',
            'complete_exam_session',
            'record_exam_gateway_rate_limit_rejection'
       ]::TEXT[]) THEN
        RETURN;
    END IF;

    IF v_method <> 'POST' THEN
        RAISE SQLSTATE 'PT405'
            USING MESSAGE = 'Protected exam RPCs require POST';
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

REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_hooks.royal_exam_pre_request()
    TO anon, authenticated, service_role, authenticator;
