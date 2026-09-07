CREATE OR REPLACE FUNCTION public.can_access_question(p_question_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.question_bank_questions qbq
        WHERE qbq.question_id = p_question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_question(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_question(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "Active users manage own notes" ON public.user_notes;
CREATE POLICY "Active users read own accessible notes"
    ON public.user_notes FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users insert own accessible notes"
    ON public.user_notes FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users update own accessible notes"
    ON public.user_notes FOR UPDATE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id))
    WITH CHECK (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users delete own accessible notes"
    ON public.user_notes FOR DELETE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));

DROP POLICY IF EXISTS "Active users manage own saved concepts" ON public.saved_concepts;
CREATE POLICY "Active users read own accessible concepts"
    ON public.saved_concepts FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users insert own accessible concepts"
    ON public.saved_concepts FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users update own accessible concepts"
    ON public.saved_concepts FOR UPDATE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id))
    WITH CHECK (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
CREATE POLICY "Active users delete own accessible concepts"
    ON public.saved_concepts FOR DELETE TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user() AND public.can_access_question(question_id));
