DROP POLICY IF EXISTS "Active users manage own question flags" ON public.user_question_flags;
CREATE POLICY "Active users read own accessible flags"
    ON public.user_question_flags FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users insert own accessible flags"
    ON public.user_question_flags FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users delete own accessible flags"
    ON public.user_question_flags FOR DELETE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
