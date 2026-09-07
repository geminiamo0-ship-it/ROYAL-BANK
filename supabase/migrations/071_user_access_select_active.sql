DROP POLICY IF EXISTS "Users can view own pathway access, support/admin can view all" ON public.user_pathway_access;
CREATE POLICY "Active users view own pathway access or staff view all"
    ON public.user_pathway_access FOR SELECT TO authenticated
    USING (
        (auth.uid() = user_id AND public.is_active_user())
        OR public.is_support_or_admin()
    );
