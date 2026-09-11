-- Preserve RLS semantics while letting PostgreSQL evaluate auth.uid() once per
-- statement instead of once per candidate row.
--
-- Production historically contained a few policies that are not present in a
-- clean rebuild of the consolidated baseline. Treat this migration as an
-- optimization of policies that exist, rather than making their presence a
-- prerequisite for rebuilding the database.

DO $$
DECLARE
    item record;
BEGIN
    FOR item IN
        SELECT *
        FROM (VALUES
            ('public', 'test_session_questions', 'Users can view own session questions', $policy$
                ALTER POLICY "Users can view own session questions"
                ON public.test_session_questions
                USING (
                    EXISTS (
                        SELECT 1
                        FROM public.test_sessions ts
                        WHERE ts.id = test_session_questions.test_session_id
                          AND (ts.user_id = (SELECT auth.uid()) OR public.is_support_or_admin())
                    )
                )
            $policy$),
            ('public', 'profiles', 'Users view own profile or active staff view all', $policy$
                ALTER POLICY "Users view own profile or active staff view all"
                ON public.profiles
                USING (((SELECT auth.uid()) = id) OR public.is_support_or_admin())
            $policy$),
            ('public', 'login_history', 'Active users insert own login history', $policy$
                ALTER POLICY "Active users insert own login history"
                ON public.login_history
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user())
            $policy$),
            ('public', 'login_history', 'Users view own login history or admins view all', $policy$
                ALTER POLICY "Users view own login history or admins view all"
                ON public.login_history
                USING ((((SELECT auth.uid()) = user_id) AND public.is_active_user()) OR public.is_admin())
            $policy$),
            ('public', 'free_trial_block_usage', 'Users view own trial usage or staff audit all', $policy$
                ALTER POLICY "Users view own trial usage or staff audit all"
                ON public.free_trial_block_usage
                USING ((((SELECT auth.uid()) = user_id) AND public.is_active_user()) OR public.is_support_or_admin())
            $policy$),
            ('public', 'user_notes', 'Active users insert own accessible notes', $policy$
                ALTER POLICY "Active users insert own accessible notes"
                ON public.user_notes
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'user_notes', 'Active users update own accessible notes', $policy$
                ALTER POLICY "Active users update own accessible notes"
                ON public.user_notes
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'user_notes', 'Active users delete own accessible notes', $policy$
                ALTER POLICY "Active users delete own accessible notes"
                ON public.user_notes
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'user_notes', 'Active users read own note history', $policy$
                ALTER POLICY "Active users read own note history"
                ON public.user_notes
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user())
            $policy$),
            ('public', 'saved_concepts', 'Active users insert own accessible concepts', $policy$
                ALTER POLICY "Active users insert own accessible concepts"
                ON public.saved_concepts
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'saved_concepts', 'Active users update own accessible concepts', $policy$
                ALTER POLICY "Active users update own accessible concepts"
                ON public.saved_concepts
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'saved_concepts', 'Active users delete own accessible concepts', $policy$
                ALTER POLICY "Active users delete own accessible concepts"
                ON public.saved_concepts
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'saved_concepts', 'Active users read own concept history', $policy$
                ALTER POLICY "Active users read own concept history"
                ON public.saved_concepts
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user())
            $policy$),
            ('public', 'user_answers', 'Active users insert own accessible answers', $policy$
                ALTER POLICY "Active users insert own accessible answers"
                ON public.user_answers
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'user_answers', 'Active users update own accessible answers', $policy$
                ALTER POLICY "Active users update own accessible answers"
                ON public.user_answers
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question(question_id))
            $policy$),
            ('public', 'user_answers', 'Active users read own answer history', $policy$
                ALTER POLICY "Active users read own answer history"
                ON public.user_answers
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user())
            $policy$),
            ('public', 'test_sessions', 'Active users update own accessible test_sessions', $policy$
                ALTER POLICY "Active users update own accessible test_sessions"
                ON public.test_sessions
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question_bank(question_bank_id))
                WITH CHECK (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND public.can_access_question_bank(question_bank_id))
            $policy$),
            ('public', 'test_sessions', 'Active users delete own incomplete test_sessions', $policy$
                ALTER POLICY "Active users delete own incomplete test_sessions"
                ON public.test_sessions
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user() AND (is_completed = FALSE))
            $policy$),
            ('public', 'test_sessions', 'Active users read own session history', $policy$
                ALTER POLICY "Active users read own session history"
                ON public.test_sessions
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user())
            $policy$),
            ('public', 'user_access_grants', 'Users can view own scoped access', $policy$
                ALTER POLICY "Users can view own scoped access"
                ON public.user_access_grants
                USING (((SELECT auth.uid()) = user_id) OR public.is_support_or_admin())
            $policy$),
            ('public', 'user_question_flags', 'Active users read own flag history', $policy$
                ALTER POLICY "Active users read own flag history"
                ON public.user_question_flags
                USING (((SELECT auth.uid()) = user_id) AND public.is_active_user())
            $policy$)
        ) AS policies(schema_name, table_name, policy_name, ddl)
    LOOP
        IF EXISTS (
            SELECT 1
            FROM pg_policies p
            WHERE p.schemaname = item.schema_name
              AND p.tablename = item.table_name
              AND p.policyname = item.policy_name
        ) THEN
            EXECUTE item.ddl;
        END IF;
    END LOOP;
END;
$$;
