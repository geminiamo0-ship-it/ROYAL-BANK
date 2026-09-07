CREATE OR REPLACE FUNCTION public.owns_test_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = p_session_id
          AND ts.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.owns_test_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_test_session(UUID) TO authenticated;

DROP POLICY IF EXISTS "Users read own locked session questions" ON public.test_session_questions;
CREATE POLICY "Users read own locked session questions"
    ON public.test_session_questions FOR SELECT TO authenticated
    USING (public.is_active_user() AND public.owns_test_session(test_session_id));
