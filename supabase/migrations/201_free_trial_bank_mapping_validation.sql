-- A bank configured for trial must have content mapped before users can consume quota.
CREATE OR REPLACE FUNCTION public.admin_configure_bank_access(
    p_bank_id BIGINT,
    p_is_free_trial BOOLEAN,
    p_free_trial_block_limit INT DEFAULT NULL
)
RETURNS public.question_banks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    bank_row public.question_banks;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    IF p_is_free_trial AND p_free_trial_block_limit IS NULL THEN
        RAISE EXCEPTION 'Free-trial banks require a block limit';
    END IF;

    IF p_free_trial_block_limit IS NOT NULL AND p_free_trial_block_limit < 0 THEN
        RAISE EXCEPTION 'Free-trial block limit cannot be negative';
    END IF;

    IF p_is_free_trial AND NOT EXISTS (
        SELECT 1 FROM public.question_bank_questions qbq WHERE qbq.question_bank_id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'Cannot enable trial on a bank with no mapped questions';
    END IF;

    UPDATE public.question_banks
    SET
        is_free_trial = p_is_free_trial,
        free_trial_block_limit = CASE WHEN p_is_free_trial THEN p_free_trial_block_limit ELSE NULL END
    WHERE id = p_bank_id
    RETURNING * INTO bank_row;

    IF bank_row.id IS NULL THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    RETURN bank_row;
END;
$$;
