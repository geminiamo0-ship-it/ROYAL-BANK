UPDATE public.question_banks
SET free_trial_block_limit = NULL
WHERE is_free_trial = FALSE;
