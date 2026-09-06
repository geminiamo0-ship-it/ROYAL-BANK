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
        AND public.is_active_user()
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
