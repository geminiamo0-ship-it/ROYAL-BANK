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

-- Legacy exam RPCs predate the Royal gateway. Current main uses the bootstrap,
-- window, review, submit, feedback, flag and complete RPCs through /api/exam.
-- Leaving these names browser-callable would bypass gateway rate limiting and
-- request proof enforcement even though their bodies still perform user checks.
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
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END LOOP;
END;
$$;
