DROP POLICY IF EXISTS "Active users can view own trial usage" ON public.free_trial_block_usage;
CREATE POLICY "Users view own trial usage or staff audit all"
    ON public.free_trial_block_usage FOR SELECT TO authenticated
    USING (
        (auth.uid() = user_id AND public.is_active_user())
        OR public.is_support_or_admin()
    );
