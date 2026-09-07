-- Gate direct question content reads by bank access.
-- Admin/support may inspect all content. Students may read content belonging to a
-- free bank/block or a pathway for which they hold unexpired premium access.

CREATE OR REPLACE FUNCTION public.can_access_question_bank(p_bank_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            public.is_support_or_admin()
            OR EXISTS (
                SELECT 1
                FROM public.blocks b
                WHERE b.question_bank_id = p_bank_id
                  AND b.is_free = TRUE
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

REVOKE ALL ON FUNCTION public.can_access_question_bank(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_question_bank(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_access_question_bank(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read question_banks" ON public.question_banks;
CREATE POLICY "Users can read accessible question banks"
    ON public.question_banks FOR SELECT
    TO authenticated
    USING (public.can_access_question_bank(id));

DROP POLICY IF EXISTS "Authenticated users can read question_bank_questions" ON public.question_bank_questions;
CREATE POLICY "Users can read accessible bank mappings"
    ON public.question_bank_questions FOR SELECT
    TO authenticated
    USING (public.can_access_question_bank(question_bank_id));

DROP POLICY IF EXISTS "Authenticated users can read questions" ON public.questions;
CREATE POLICY "Users can read accessible questions"
    ON public.questions FOR SELECT
    TO authenticated
    USING (
        public.is_support_or_admin()
        OR EXISTS (
            SELECT 1
            FROM public.question_bank_questions qbq
            WHERE qbq.question_id = questions.id
              AND public.can_access_question_bank(qbq.question_bank_id)
        )
    );

DROP POLICY IF EXISTS "Authenticated users can read options" ON public.options;
CREATE POLICY "Users can read options for accessible questions"
    ON public.options FOR SELECT
    TO authenticated
    USING (
        public.is_support_or_admin()
        OR EXISTS (
            SELECT 1
            FROM public.question_bank_questions qbq
            WHERE qbq.question_id = options.question_id
              AND public.can_access_question_bank(qbq.question_bank_id)
        )
    );
