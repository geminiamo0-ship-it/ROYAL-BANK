-- Trusted service-role maintenance may not have auth.uid(). Keep audit trails valid
-- without breaking ingestion/admin maintenance by falling back to the affected user
-- where a natural actor exists. Bank config changes still require an authenticated
-- admin through the public RPC.

ALTER TABLE public.pathway_access_audit ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE public.profile_access_audit ALTER COLUMN changed_by DROP NOT NULL;
ALTER TABLE public.bank_access_audit ALTER COLUMN changed_by DROP NOT NULL;
