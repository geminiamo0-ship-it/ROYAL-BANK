-- Existing Bank 1 was historically the trial bank. Give it a finite default quota
-- during migration so the new database-side quota guard does not lock all trial
-- users out. Admin can change this later with admin_configure_bank_access().

UPDATE public.question_banks
SET free_trial_block_limit = 4
WHERE id = 1
  AND is_free_trial = TRUE
  AND free_trial_block_limit IS NULL;
