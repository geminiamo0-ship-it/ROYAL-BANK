DROP POLICY IF EXISTS "Active users read own test_sessions" ON public.test_sessions;
CREATE POLICY "Active users read own accessible test_sessions"
    ON public.test_sessions FOR SELECT TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question_bank(question_bank_id)
    );

DROP POLICY IF EXISTS "Active users update own test_sessions" ON public.test_sessions;
CREATE POLICY "Active users update own accessible test_sessions"
    ON public.test_sessions FOR UPDATE TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question_bank(question_bank_id)
    )
    WITH CHECK (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question_bank(question_bank_id)
    );

-- Deletion remains allowed for the owner so an expired subscription does not trap
-- stale sessions; deleting an unfinished session releases unanswered locks.
