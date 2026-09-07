DROP POLICY IF EXISTS "Users can view own trial usage" ON public.free_trial_block_usage;
CREATE POLICY "Active users can view own trial usage"
    ON public.free_trial_block_usage FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND public.is_active_user());
