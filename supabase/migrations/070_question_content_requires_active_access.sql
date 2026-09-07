-- Recreate content policies explicitly after active-user access hardening.
DROP POLICY IF EXISTS "Users can read accessible bank mappings" ON public.question_bank_questions;
CREATE POLICY "Active users can read accessible bank mappings"
    ON public.question_bank_questions FOR SELECT TO authenticated
    USING (public.can_access_question_bank(question_bank_id));

DROP POLICY IF EXISTS "Users can read accessible questions" ON public.questions;
CREATE POLICY "Active users can read accessible questions"
    ON public.questions FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.question_bank_questions qbq
            WHERE qbq.question_id = questions.id
              AND public.can_access_question_bank(qbq.question_bank_id)
        )
    );

DROP POLICY IF EXISTS "Users can read options for accessible questions" ON public.options;
CREATE POLICY "Active users can read options for accessible questions"
    ON public.options FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.question_bank_questions qbq
            WHERE qbq.question_id = options.question_id
              AND public.can_access_question_bank(qbq.question_bank_id)
        )
    );
