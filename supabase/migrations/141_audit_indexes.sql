CREATE INDEX IF NOT EXISTS idx_bank_access_audit_bank_time
ON public.bank_access_audit(question_bank_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pathway_access_audit_user_time
ON public.pathway_access_audit(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_access_audit_user_time
ON public.profile_access_audit(user_id, changed_at DESC);
