CREATE INDEX IF NOT EXISTS idx_user_pathway_access_active_premium
ON public.user_pathway_access(user_id, pathway_id, expires_at)
WHERE access_type = 'premium';
