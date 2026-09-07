-- A question/option must belong to an accessible bank. This deliberately removes
-- the broad support/admin shortcut from content SELECT policies so even privileged
-- users access content through explicit bank membership. Trusted ingestion uses the
-- service role and bypasses RLS.

DROP POLICY IF EXISTS "Users can read accessible questions" ON public.questions;
CREATE POLICY "Users can read accessible questions"
    ON public.questions FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.question_bank_questions qbq
            WHERE qbq.question_id = questions.id
              AND public.can_access_question_bank(qbq.question_bank_id)
        )
    );

DROP POLICY IF EXISTS "Users can read options for accessible questions" ON public.options;
CREATE POLICY "Users can read options for accessible questions"
    ON public.options FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.question_bank_questions qbq
            WHERE qbq.question_id = options.question_id
              AND public.can_access_question_bank(qbq.question_bank_id)
        )
    );
