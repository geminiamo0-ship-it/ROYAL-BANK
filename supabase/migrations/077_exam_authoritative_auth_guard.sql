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
-- The lookup is local to Postgres and uses auth.users_pkey. The gateway secret check
-- remains mandatory and is still performed before marking the request verified.

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

-- Patch the currently installed api_hooks pre-request function instead of copying its
-- protected RPC allowlist. Fail closed if the expected terminal block has changed.
DO $migration$
DECLARE
    v_def text;
    v_old text := $old$
    PERFORM set_config('request.royal_gateway_verified', '1', true);
END;
$old$;
    v_new text := $new$
    -- PostgREST has already cryptographically authenticated the JWT at this point.
    -- Check live Auth state locally before any protected exam RPC is allowed through.
    PERFORM private.assert_exam_auth_user_state();
    PERFORM set_config('request.royal_gateway_verified', '1', true);
END;
$new$;
BEGIN
    SELECT pg_get_functiondef('api_hooks.royal_exam_pre_request()'::regprocedure)
    INTO v_def;

    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'EXAM_PRE_REQUEST_TERMINAL_BLOCK_CHANGED';
    END IF;
    IF position(v_old IN substr(v_def, position(v_old IN v_def) + length(v_old))) > 0 THEN
        RAISE EXCEPTION 'EXAM_PRE_REQUEST_TERMINAL_BLOCK_AMBIGUOUS';
    END IF;

    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
END;
$migration$;

COMMENT ON FUNCTION private.assert_exam_auth_user_state() IS
    'Authoritative local Auth-state guard for protected exam RPCs: live user existence, ban status, and must_change_password.';

NOTIFY pgrst, 'reload schema';
