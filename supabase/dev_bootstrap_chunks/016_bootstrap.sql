SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

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
