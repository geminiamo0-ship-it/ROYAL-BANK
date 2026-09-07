DROP POLICY IF EXISTS "System/Users can insert login history" ON public.login_history;
CREATE POLICY "Active users insert own login history"
    ON public.login_history FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id AND public.is_active_user());
