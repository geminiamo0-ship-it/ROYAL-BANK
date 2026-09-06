ALTER TABLE public.question_banks
    DROP CONSTRAINT IF EXISTS question_banks_trial_config_check;
ALTER TABLE public.question_banks
    ADD CONSTRAINT question_banks_trial_config_check
    CHECK (
        (is_free_trial = FALSE AND free_trial_block_limit IS NULL)
        OR (is_free_trial = TRUE AND free_trial_block_limit IS NOT NULL AND free_trial_block_limit >= 0)
    );
