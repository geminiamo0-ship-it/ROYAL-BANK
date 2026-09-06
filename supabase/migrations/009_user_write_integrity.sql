-- Ensure ownership-sensitive INSERT/UPDATE operations cannot create rows for
-- another user. USING controls existing rows; WITH CHECK controls new row values.

DROP POLICY IF EXISTS "Users have full access to own test_sessions" ON public.test_sessions;
CREATE POLICY "Users have full access to own test_sessions"
    ON public.test_sessions FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users have full access to own answers" ON public.user_answers;
CREATE POLICY "Users have full access to own answers"
    ON public.user_answers FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1
            FROM public.test_sessions ts
            WHERE ts.id = test_session_id
              AND ts.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users have full access to own notes" ON public.user_notes;
CREATE POLICY "Users have full access to own notes"
    ON public.user_notes FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users have full access to own saved concepts" ON public.saved_concepts;
CREATE POLICY "Users have full access to own saved concepts"
    ON public.saved_concepts FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Support and Admin can insert/update pathway access" ON public.user_pathway_access;
CREATE POLICY "Support and Admin can manage pathway access"
    ON public.user_pathway_access FOR ALL
    TO authenticated
    USING (public.is_support_or_admin())
    WITH CHECK (public.is_support_or_admin());

DROP POLICY IF EXISTS "Admins have full access to ip_blocklist" ON public.ip_blocklist;
CREATE POLICY "Admins have full access to ip_blocklist"
    ON public.ip_blocklist FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
