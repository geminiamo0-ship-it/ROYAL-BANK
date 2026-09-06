CREATE INDEX IF NOT EXISTS idx_test_sessions_user_started_desc
ON public.test_sessions(user_id, started_at DESC);
