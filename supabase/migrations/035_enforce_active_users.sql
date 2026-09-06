-- Authentication alone is not enough for a suspended/inactive account. Enforce
-- active-profile status on ownership-sensitive writes.

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND is_active = TRUE
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

DROP POLICY IF EXISTS "Users have full access to own test_sessions" ON public.test_sessions;
CREATE POLICY "Active users manage own test_sessions"
    ON public.test_sessions FOR ALL
    TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());

DROP POLICY IF EXISTS "Users have full access to own answers" ON public.user_answers;
CREATE POLICY "Active users manage own answers"
    ON public.user_answers FOR ALL
    TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());

DROP POLICY IF EXISTS "Users have full access to own notes" ON public.user_notes;
CREATE POLICY "Active users manage own notes"
    ON public.user_notes FOR ALL
    TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());

DROP POLICY IF EXISTS "Users have full access to own saved concepts" ON public.saved_concepts;
CREATE POLICY "Active users manage own saved concepts"
    ON public.saved_concepts FOR ALL
    TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());

DROP POLICY IF EXISTS "Users manage own question flags" ON public.user_question_flags;
CREATE POLICY "Active users manage own question flags"
    ON public.user_question_flags FOR ALL
    TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user())
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());
