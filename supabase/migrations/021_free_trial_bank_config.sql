-- Free-trial access belongs to a bank configuration, not a hard-coded bank ID.
-- A free-trial bank may expose a configurable number of blocks. Premium access
-- continues to be granted at pathway level.

ALTER TABLE public.question_banks
    ADD COLUMN IF NOT EXISTS is_free_trial BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS free_trial_block_limit INT;

ALTER TABLE public.question_banks
    DROP CONSTRAINT IF EXISTS question_banks_free_trial_block_limit_check;
ALTER TABLE public.question_banks
    ADD CONSTRAINT question_banks_free_trial_block_limit_check
    CHECK (free_trial_block_limit IS NULL OR free_trial_block_limit >= 0);

-- Preserve current product behavior during migration: Bank 1 is the existing trial bank.
UPDATE public.question_banks
SET is_free_trial = TRUE
WHERE id = 1
  AND NOT EXISTS (
      SELECT 1 FROM public.question_banks WHERE is_free_trial = TRUE
  );

CREATE OR REPLACE FUNCTION public.can_access_question_bank(p_bank_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            public.is_support_or_admin()
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                WHERE qb.id = p_bank_id
                  AND qb.is_free_trial = TRUE
            )
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_pathway_access upa
                  ON upa.pathway_id = qb.pathway_id
                WHERE qb.id = p_bank_id
                  AND upa.user_id = auth.uid()
                  AND upa.access_type = 'premium'
                  AND (upa.expires_at IS NULL OR upa.expires_at > now())
            )
        );
$$;
