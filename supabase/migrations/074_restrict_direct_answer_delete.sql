-- Prevent selective answer-history deletion through the table API. Session deletion
-- still cascades answers at the database level because FK cascades are not client
-- DELETE statements against user_answers.

DROP POLICY IF EXISTS "Active users manage own answers" ON public.user_answers;

CREATE POLICY "Active users read own answers"
    ON public.user_answers FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user());

CREATE POLICY "Active users insert own answers"
    ON public.user_answers FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());

CREATE POLICY "Active users update own answers"
    ON public.user_answers FOR UPDATE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());
