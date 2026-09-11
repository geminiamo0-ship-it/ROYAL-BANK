-- Preserve RLS semantics while letting PostgreSQL evaluate auth.uid() once per
-- statement instead of once per candidate row.

ALTER POLICY "Users can view own session questions"
ON public.test_session_questions
USING (
    EXISTS (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.id = test_session_questions.test_session_id
          AND (ts.user_id = (SELECT auth.uid()) OR public.is_support_or_admin())
    )
);

ALTER POLICY "Users view own profile or active staff view all"
ON public.profiles
USING (((SELECT auth.uid()) = id) OR public.is_support_or_admin());

ALTER POLICY "Active users insert own login history"
ON public.login_history
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user());

ALTER POLICY "Users view own login history or admins view all"
ON public.login_history
USING ((((SELECT auth.uid()) = user_id) AND public.is_active_user()) OR public.is_admin());

ALTER POLICY "Users view own trial usage or staff audit all"
ON public.free_trial_block_usage
USING ((((SELECT auth.uid()) = user_id) AND public.is_active_user()) OR public.is_support_or_admin());

ALTER POLICY "Active users insert own accessible notes"
ON public.user_notes
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users update own accessible notes"
ON public.user_notes
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users delete own accessible notes"
ON public.user_notes
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users read own note history"
ON public.user_notes
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user());

ALTER POLICY "Active users insert own accessible concepts"
ON public.saved_concepts
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users update own accessible concepts"
ON public.saved_concepts
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users delete own accessible concepts"
ON public.saved_concepts
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users read own concept history"
ON public.saved_concepts
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user());

ALTER POLICY "Active users insert own accessible answers"
ON public.user_answers
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users update own accessible answers"
ON public.user_answers
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id));

ALTER POLICY "Active users read own answer history"
ON public.user_answers
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user());

ALTER POLICY "Active users update own accessible test_sessions"
ON public.test_sessions
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question_bank(question_bank_id))
WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question_bank(question_bank_id));

ALTER POLICY "Active users delete own incomplete test_sessions"
ON public.test_sessions
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND (is_completed = FALSE));

ALTER POLICY "Active users read own session history"
ON public.test_sessions
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user());

ALTER POLICY "Users can view own scoped access"
ON public.user_access_grants
USING (((SELECT auth.uid()) = user_id) OR public.is_support_or_admin());

ALTER POLICY "Active users read own flag history"
ON public.user_question_flags
USING (((SELECT auth.uid()) = user_id) AND public.is_active_user());
