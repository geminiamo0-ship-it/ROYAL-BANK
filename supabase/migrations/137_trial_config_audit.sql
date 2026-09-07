CREATE TABLE IF NOT EXISTS public.bank_access_audit (
    id BIGSERIAL PRIMARY KEY,
    question_bank_id BIGINT NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES public.profiles(id),
    is_free_trial BOOLEAN NOT NULL,
    free_trial_block_limit INT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.bank_access_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read bank access audit"
    ON public.bank_access_audit FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.audit_bank_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF OLD.is_free_trial IS DISTINCT FROM NEW.is_free_trial
       OR OLD.free_trial_block_limit IS DISTINCT FROM NEW.free_trial_block_limit THEN
        INSERT INTO public.bank_access_audit (
            question_bank_id, changed_by, is_free_trial, free_trial_block_limit
        ) VALUES (
            NEW.id, auth.uid(), NEW.is_free_trial, NEW.free_trial_block_limit
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_bank_access_change_trigger ON public.question_banks;
CREATE TRIGGER audit_bank_access_change_trigger
    AFTER UPDATE OF is_free_trial, free_trial_block_limit ON public.question_banks
    FOR EACH ROW EXECUTE FUNCTION public.audit_bank_access_change();

REVOKE ALL ON FUNCTION public.audit_bank_access_change() FROM PUBLIC;
