DROP POLICY IF EXISTS "Active users insert own answers" ON public.user_answers;
CREATE POLICY "Active users insert own accessible answers"
    ON public.user_answers FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question(question_id)
    );

DROP POLICY IF EXISTS "Active users update own answers" ON public.user_answers;
CREATE POLICY "Active users update own accessible answers"
    ON public.user_answers FOR UPDATE TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question(question_id)
    )
    WITH CHECK (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question(question_id)
    );
