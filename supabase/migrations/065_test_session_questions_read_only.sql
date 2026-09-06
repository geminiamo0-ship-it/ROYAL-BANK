-- Clients may read their locked set, but selection/locking must be performed by the
-- trusted session-creation RPC. Prevent direct INSERT/UPDATE/DELETE tampering.

DROP POLICY IF EXISTS "Users manage own locked session questions" ON public.test_session_questions;
CREATE POLICY "Users read own locked session questions"
    ON public.test_session_questions FOR SELECT
    TO authenticated
    USING (
        public.is_active_user()
        AND EXISTS (
            SELECT 1 FROM public.test_sessions ts
            WHERE ts.id = test_session_id
              AND ts.user_id = auth.uid()
        )
    );
