DROP POLICY IF EXISTS "Active users read own answers" ON public.user_answers;
CREATE POLICY "Active users read own accessible answers"
    ON public.user_answers FOR SELECT TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
        AND public.can_access_question(question_id)
    );
