CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_usage_live_session
ON public.free_trial_block_usage(test_session_id)
WHERE test_session_id IS NOT NULL;
