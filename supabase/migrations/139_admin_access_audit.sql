CREATE TABLE IF NOT EXISTS public.profile_access_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES public.profiles(id),
    role TEXT NOT NULL,
    subscription_tier TEXT NOT NULL,
    is_active BOOLEAN NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profile_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read profile access audit"
    ON public.profile_access_audit FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.audit_profile_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF OLD.role IS DISTINCT FROM NEW.role
       OR OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier
       OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        INSERT INTO public.profile_access_audit (
            user_id, changed_by, role, subscription_tier, is_active
        ) VALUES (
            NEW.id, auth.uid(), NEW.role, NEW.subscription_tier, NEW.is_active
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_profile_access_change_trigger ON public.profiles;
CREATE TRIGGER audit_profile_access_change_trigger
    AFTER UPDATE OF role, subscription_tier, is_active ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.audit_profile_access_change();

REVOKE ALL ON FUNCTION public.audit_profile_access_change() FROM PUBLIC;
