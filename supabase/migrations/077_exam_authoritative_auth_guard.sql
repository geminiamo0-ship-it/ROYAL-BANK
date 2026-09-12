-- Keep exam authentication authoritative without a remote GoTrue user lookup on
-- every /api/exam request. PostgREST verifies the bearer JWT before invoking its
-- db_pre_request hook, so the hook can cheaply validate the live auth.users row by
-- primary key before any protected exam RPC executes.
--
-- This preserves the security properties previously enforced by middleware:
-- - deleted/non-existent users are rejected immediately
-- - currently banned users are rejected immediately
-- - admin-issued must_change_password is enforced from live auth.users metadata,
--   even when an older access-token claim has not refreshed yet
--
-- The lookup is local to Postgres and uses auth.users_pkey. The live user-state guard
-- is intentionally independent from the gateway-enforcement toggle: temporarily
-- disabling the gateway transport control must never disable account-state checks.

CREATE OR REPLACE FUNCTION private.assert_exam_auth_user_state()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'auth', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_deleted_at timestamptz;
    v_banned_until timestamptz;
    v_app_metadata jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE SQLSTATE 'PT401' USING MESSAGE = 'INVALID_AUTH_TOKEN';
    END IF;

    SELECT u.deleted_at, u.banned_until, u.raw_app_meta_data
    INTO v_deleted_at, v_banned_until, v_app_metadata
    FROM auth.users u
    WHERE u.id = v_user_id;

    IF NOT FOUND OR v_deleted_at IS NOT NULL THEN
        RAISE SQLSTATE 'PT401' USING MESSAGE = 'INVALID_AUTH_TOKEN';
    END IF;

    IF v_banned_until IS NOT NULL AND v_banned_until > clock_timestamp() THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'ACCOUNT_BANNED';
    END IF;

    IF COALESCE(v_app_metadata->>'must_change_password', 'false') = 'true' THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'PASSWORD_CHANGE_REQUIRED';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_exam_auth_user_state()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION api_hooks.royal_exam_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_cfg private.exam_gateway_config%ROWTYPE;
    v_gateway_enforcement_enabled boolean := false;
    v_path text := NULLIF(current_setting('request.path', true), '');
    v_method text := UPPER(COALESCE(NULLIF(current_setting('request.method', true), ''), ''));
    v_headers jsonb := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
    v_rpc_name text;
    v_key_id text;
    v_key text;
BEGIN
    PERFORM set_config('request.royal_gateway_verified', '0', true);

    SELECT * INTO v_cfg
    FROM private.exam_gateway_config
    WHERE singleton = true;
    v_gateway_enforcement_enabled := COALESCE(v_cfg.enforcement_enabled, false);

    v_rpc_name := substring(COALESCE(v_path, '') FROM '/rpc/([^/?]+)$');
    IF v_rpc_name IS NULL OR v_rpc_name <> ALL (ARRAY[
        'create_exam_session','get_exam_session_answers',
        'create_exam_session_bootstrap','create_exam_session_bootstrap_idempotent',
        'create_exam_session_bootstrap_idempotent_v2','create_exam_session_bootstrap_idempotent_v3',
        'get_exam_session_bootstrap','get_exam_session_bootstrap_v2','get_exam_session_bootstrap_v3',
        'get_exam_session_bootstrap_ref','get_exam_session_bootstrap_ref_v2','get_exam_session_bootstrap_ref_v3',
        'get_exam_session_window','get_exam_session_window_refs','get_exam_session_window_refs_v2',
        'get_completed_exam_review_bootstrap','get_completed_exam_review_bootstrap_ref','get_completed_exam_review_bootstrap_ref_v2',
        'get_completed_exam_review_window','get_completed_exam_review_window_refs','get_completed_exam_review_window_refs_v2',
        'get_completed_exam_review_feedback','get_completed_exam_review_feedback_ref_v2',
        'submit_exam_answer','submit_exam_answer_idempotent',
        'submit_exam_answer_with_feedback','submit_exam_answer_with_feedback_idempotent',
        'submit_exam_answer_with_feedback_ref_idempotent','submit_exam_answer_with_feedback_ref_idempotent_v2',
        'get_exam_question_feedback','get_exam_question_feedback_ref','get_exam_question_feedback_ref_v2',
        'get_exam_training_feedback','get_exam_training_feedback_ref','get_exam_training_feedback_ref_v2',
        'renew_exam_window_access','set_question_flag','complete_exam_session',
        'record_exam_gateway_rate_limit_rejection'
    ]::text[]) THEN
        RETURN;
    END IF;

    IF v_method <> 'POST' THEN
        RAISE SQLSTATE 'PT405' USING MESSAGE = 'Protected exam RPCs require POST';
    END IF;

    -- Preserve the gateway proof as an independent transport/origin control whenever
    -- enforcement is enabled. Keep its failure precedence before user-state details.
    IF v_gateway_enforcement_enabled THEN
        v_key_id := NULLIF(v_headers->>'x-royal-gateway-key-id', '');
        v_key := NULLIF(v_headers->>'x-royal-gateway-key', '');
        IF v_key_id IS NULL OR v_key IS NULL
           OR NOT private.is_valid_exam_gateway_key(v_key_id, v_key, clock_timestamp()) THEN
            RAISE SQLSTATE 'PT403' USING MESSAGE = 'Exam gateway required';
        END IF;
        PERFORM set_config('request.royal_gateway_verified', '1', true);
    END IF;

    -- PostgREST has already cryptographically authenticated the JWT at this point.
    -- Check the live Auth row locally before allowing any protected exam RPC through.
    PERFORM private.assert_exam_auth_user_state();
END;
$function$;

-- PostgREST invokes db_pre_request after impersonating the API role. Preserve the
-- execute grants introduced when the hook was moved out of the public RPC schema.
REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request()
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_hooks.royal_exam_pre_request()
    TO anon, authenticated, service_role, authenticator;

COMMENT ON FUNCTION private.assert_exam_auth_user_state() IS
    'Authoritative local Auth-state guard for protected exam RPCs: live user existence, ban status, and must_change_password.';

NOTIFY pgrst, 'reload schema';
