CREATE INDEX IF NOT EXISTS idx_free_trial_usage_user_bank_count
ON public.free_trial_block_usage(user_id, question_bank_id, id);
