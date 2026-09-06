CREATE INDEX IF NOT EXISTS idx_test_sessions_user_bank_active
ON public.test_sessions(user_id, question_bank_id, is_completed, started_at DESC);
