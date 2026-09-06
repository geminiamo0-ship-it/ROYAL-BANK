DROP POLICY IF EXISTS "Admins have full access to ip_blocklist" ON public.ip_blocklist;
CREATE POLICY "Admins read ip blocklist"
    ON public.ip_blocklist FOR SELECT TO authenticated
    USING (public.is_admin());
CREATE POLICY "Admins insert ip blocklist"
    ON public.ip_blocklist FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());
CREATE POLICY "Admins update ip blocklist"
    ON public.ip_blocklist FOR UPDATE TO authenticated
    USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins delete ip blocklist"
    ON public.ip_blocklist FOR DELETE TO authenticated
    USING (public.is_admin());
