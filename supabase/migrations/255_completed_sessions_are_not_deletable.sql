-- Completed sessions are immutable history. Users may delete only unfinished
-- sessions. Current bank access is deliberately not required so a user can clean
-- up an unfinished block after access expires.

DROP POLICY IF EXISTS "Active users manage own test_sessions" ON public.test_sessions;
DROP POLICY IF EXISTS "Active users delete own test_sessions" ON public.test_sessions;

CREATE POLICY "Active users delete own incomplete test_sessions"
    ON public.test_sessions
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
        AND is_completed = FALSE
    );

COMMENT ON TABLE public.test_sessions IS
'Completed sessions are immutable history and cannot be deleted by students. Incomplete sessions may be deleted by their active owner even after bank access expires; cascading answers/locks are removed while trial consumption remains.';
