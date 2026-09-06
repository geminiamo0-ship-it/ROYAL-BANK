-- Bank-to-question membership itself reveals premium content identifiers, so gate
-- the mapping table with the same bank-access rule as question content.

DROP POLICY IF EXISTS "Users can read accessible bank mappings" ON public.question_bank_questions;
CREATE POLICY "Users can read accessible bank mappings"
    ON public.question_bank_questions FOR SELECT
    TO authenticated
    USING (public.can_access_question_bank(question_bank_id));
