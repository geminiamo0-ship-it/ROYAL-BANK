-- Runs before 097 so existing rows satisfy the stricter trial configuration check.
UPDATE public.question_banks
SET free_trial_block_limit = NULL
WHERE is_free_trial = FALSE;

UPDATE public.question_banks
SET free_trial_block_limit = 4
WHERE is_free_trial = TRUE
  AND free_trial_block_limit IS NULL;
