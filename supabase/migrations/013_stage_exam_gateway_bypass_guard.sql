-- Stage the Royal exam gateway bypass guard without enabling it yet.
--
-- This migration is intentionally production-safe before the Vercel gateway secret
-- is configured: the pre-request function is registered, but enforcement defaults
-- to FALSE. Activation is a separate audited step after the frontend is routed
-- through the gateway and latency has been benchmarked.
--
-- Security rules:
-- - Raw gateway secrets are never stored in Postgres; only SHA-256 digests of
--   high-entropy random secrets are stored.
-- - The gateway proof is an additional transport/origin control only. User identity,
--   ownership, entitlement, trial quota, and answer finality remain DB-authoritative.
-- - Client-supplied IP / User-Agent fingerprints are never trusted. Disclosure
--   fingerprints are captured only after the pre-request hook validated a gateway key.

CREATE TABLE IF NOT EXISTS private.exam_gateway_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO private.exam_gateway_config(singleton)
VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.exam_gateway_keys (
    key_id TEXT PRIMARY KEY CHECK (length(key_id) BETWEEN 1 AND 64),
    secret_digest BYTEA NOT NULL CHECK (octet_length(secret_digest) = 32),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    valid_until TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_exam_gateway_keys_active
    ON private.exam_gateway_keys(enabled, valid_from, valid_until);

REVOKE ALL ON private.exam_gateway_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.exam_gateway_keys FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.is_valid_exam_gateway_key(
    p_key_id TEXT,
    p_secret TEXT,
    p_now TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private, extensions, pg_temp
AS $$
    SELECT COALESCE(EXISTS (
        SELECT 1
        FROM private.exam_gateway_keys k
        WHERE k.key_id = p_key_id
          AND k.enabled = TRUE
          AND k.valid_from <= p_now
          AND (k.valid_until IS NULL OR k.valid_until > p_now)
          AND k.secret_digest = extensions.digest(p_secret, 'sha256')
    ), FALSE);
$$;

REVOKE ALL ON FUNCTION private.is_valid_exam_gateway_key(TEXT, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;

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
    -- Clear the marker defensively for pooled connections / nested calls.
    PERFORM set_config('request.royal_gateway_verified', '0', TRUE);

    SELECT * INTO v_cfg
    FROM private.exam_gateway_config
    WHERE singleton = TRUE;

    IF NOT FOUND OR NOT v_cfg.enforcement_enabled THEN
        RETURN;
    END IF;

    -- Supabase/Kong may expose the path either as /rpc/<name> or with a REST
    -- prefix. Matching the terminal /rpc/<name> segment handles both forms.
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
            'complete_exam_session'
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

    -- This marker is set only by this DB-side hook after secret verification. It is
    -- not an identity/entitlement proof and is used only to gate risk telemetry.
    PERFORM set_config('request.royal_gateway_verified', '1', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.royal_exam_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.royal_exam_pre_request()
    TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.capture_disclosure_gateway_signals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    v_verified BOOLEAN := COALESCE(
        NULLIF(current_setting('request.royal_gateway_verified', TRUE), ''),
        '0'
    ) = '1';
    v_headers JSONB;
BEGIN
    IF NOT v_verified THEN
        RETURN NEW;
    END IF;

    v_headers := COALESCE(
        NULLIF(current_setting('request.headers', TRUE), ''),
        '{}'
    )::jsonb;

    IF NEW.first_ip_hmac IS NULL THEN
        NEW.first_ip_hmac := NULLIF(v_headers->>'x-royal-ip-hmac', '');
    END IF;

    IF NEW.first_user_agent_hmac IS NULL THEN
        NEW.first_user_agent_hmac := NULLIF(v_headers->>'x-royal-ua-hmac', '');
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_disclosure_gateway_signals()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a0_capture_disclosure_gateway_signals
    ON private.question_disclosures;
CREATE TRIGGER a0_capture_disclosure_gateway_signals
BEFORE INSERT ON private.question_disclosures
FOR EACH ROW
EXECUTE FUNCTION private.capture_disclosure_gateway_signals();

-- Register the hook now while enforcement is disabled. This makes activation a
-- single config change later and lets us benchmark the no-op hook before cutover.
ALTER ROLE authenticator
    SET pgrst.db_pre_request = 'public.royal_exam_pre_request';
NOTIFY pgrst, 'reload config';
