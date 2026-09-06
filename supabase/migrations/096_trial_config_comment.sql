COMMENT ON COLUMN public.question_banks.is_free_trial IS
'Whether authenticated non-premium users may access this bank.';
COMMENT ON COLUMN public.question_banks.free_trial_block_limit IS
'Maximum lifetime trial blocks per user for this bank. NULL is invalid while is_free_trial is true.';
