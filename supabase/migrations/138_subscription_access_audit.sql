CREATE TABLE IF NOT EXISTS public.pathway_access_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    pathway_id BIGINT NOT NULL REFERENCES public.pathways(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES public.profiles(id),
    access_type TEXT NOT NULL,
    blocks_allowed INT NOT NULL,
    expires_at TIMESTAMPTZ,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.pathway_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read pathway access audit"
    ON public.pathway_access_audit FOR SELECT TO authenticated
    USING (public.is_support_or_admin());

CREATE OR REPLACE FUNCTION public.audit_pathway_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    INSERT INTO public.pathway_access_audit (
        user_id, pathway_id, changed_by, access_type, blocks_allowed, expires_at
    ) VALUES (
        NEW.user_id, NEW.pathway_id, auth.uid(), NEW.access_type, NEW.blocks_allowed, NEW.expires_at
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_pathway_access_change_trigger ON public.user_pathway_access;
CREATE TRIGGER audit_pathway_access_change_trigger
    AFTER INSERT OR UPDATE ON public.user_pathway_access
    FOR EACH ROW EXECUTE FUNCTION public.audit_pathway_access_change();

REVOKE ALL ON FUNCTION public.audit_pathway_access_change() FROM PUBLIC;
