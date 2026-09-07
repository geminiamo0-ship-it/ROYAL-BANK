-- Session creation/locking is a trusted operation. Clients may read/update/delete
-- their own sessions, but INSERT must go through create_exam_session (SECURITY
-- DEFINER) so selection, locking, access checks, and trial quota cannot be bypassed.

DROP POLICY IF EXISTS "Active users manage own test_sessions" ON public.test_sessions;

CREATE POLICY "Active users read own test_sessions"
    ON public.test_sessions FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user());

CREATE POLICY "Active users update own test_sessions"
    ON public.test_sessions FOR UPDATE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());

CREATE POLICY "Active users delete own test_sessions"
    ON public.test_sessions FOR DELETE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user());
