-- Locked question sets are user-sensitive exam state and must follow session ownership.

ALTER TABLE public.test_session_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own locked session questions" ON public.test_session_questions;
CREATE POLICY "Users manage own locked session questions"
    ON public.test_session_questions FOR ALL
    TO authenticated
    USING (
        public.is_active_user()
        AND EXISTS (
            SELECT 1 FROM public.test_sessions ts
            WHERE ts.id = test_session_id
              AND ts.user_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_active_user()
        AND EXISTS (
            SELECT 1 FROM public.test_sessions ts
            WHERE ts.id = test_session_id
              AND ts.user_id = auth.uid()
        )
    );
