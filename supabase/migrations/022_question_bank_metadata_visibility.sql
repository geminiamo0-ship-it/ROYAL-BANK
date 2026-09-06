-- Bank metadata is navigation/catalog data. Keep it visible to authenticated users
-- so locked banks can still be rendered in the UI; question content remains gated
-- by the question/mapping/options policies.

DROP POLICY IF EXISTS "Users can read accessible question banks" ON public.question_banks;
CREATE POLICY "Authenticated users can read question bank metadata"
    ON public.question_banks FOR SELECT
    TO authenticated
    USING (true);
