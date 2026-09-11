-- Close legacy browser-callable exam paths and internal SECURITY DEFINER helpers.
-- The supported exam browser surface is /api/exam -> the gateway-protected RPCs.
-- Question content itself remains RPC-only (migration 049).

-- These policies are now dead browser policy surface because anon/authenticated
-- no longer have table/column privileges on the question content tables.
DROP POLICY IF EXISTS "Admins have full access to questions" ON public.questions;
DROP POLICY IF EXISTS "Active users can read accessible questions" ON public.questions;
DROP POLICY IF EXISTS "Admins have full access to options" ON public.options;
DROP POLICY IF EXISTS "Active users can read options for accessible questions" ON public.options;
DROP POLICY IF EXISTS "Admins have full access to question_bank_questions" ON public.question_bank_questions;
DROP POLICY IF EXISTS "Active users can read accessible bank mappings" ON public.question_bank_questions;

-- Preserve the effective production SELECT semantics for locked session rows,
-- but express them as one authenticated-only policy instead of two overlapping
-- permissive policies. Anonymous callers never had a usable auth.uid() here and
-- do not need table SELECT at all.
DROP POLICY IF EXISTS "Users can view own session questions" ON public.test_session_questions;
DROP POLICY IF EXISTS "Users read accessible locked session questions" ON public.test_session_questions;

CREATE POLICY "Authenticated users read owned session questions"
ON public.test_session_questions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.id = test_session_questions.test_session_id
          AND (
              ts.user_id = (SELECT auth.uid())
              OR public.is_support_or_admin()
          )
    )
);

REVOKE SELECT ON public.test_session_questions FROM anon;

-- Trigger and event-trigger functions are implementation details. They should
-- never be callable as an authenticated PostgREST RPC. Existing triggers keep
-- invoking them normally; service_role retains explicit maintenance access.
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.prorettype IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END LOOP;
END;
$$;

-- Legacy exam RPCs are still exercised by low-level database behavior tests and
-- by internal compatibility paths, so retain authenticated SQL EXECUTE. They
-- must never be callable directly through PostgREST: extend the same pre-request
-- gateway enforcement used by the current exam RPCs to cover the legacy names.
-- pg_graphql is not enabled in production, so PostgREST is the exposed function
-- API surface for these RPCs.
DO $$
DECLARE
    fn record;
BEGIN
    FOR fn IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('create_exam_session', 'get_exam_session_answers')
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn.signature);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION api_hooks.royal_exam_pre_request()
RETURNS void
LANGUAGE plpgsql
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

    IF v_rpc_name IS NULL
       OR v_rpc_name <> ALL (ARRAY[
            'create_exam_session',
            'get_exam_session_answers',
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
