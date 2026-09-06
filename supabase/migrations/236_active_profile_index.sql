CREATE INDEX IF NOT EXISTS idx_profiles_active_role
ON public.profiles(id, role)
WHERE is_active = TRUE;
