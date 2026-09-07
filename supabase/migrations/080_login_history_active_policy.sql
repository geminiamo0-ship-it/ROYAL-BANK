DROP POLICY IF EXISTS "Users can view own login history, admins can view all" ON public.login_history;
CREATE POLICY "Users view own login history or admins view all"
    ON public.login_history FOR SELECT TO authenticated
    USING (
        (auth.uid() = user_id AND public.is_active_user())
        OR public.is_admin()
    );
