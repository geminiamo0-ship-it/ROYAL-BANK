-- Business invariant: every question belongs to exactly one question bank.
-- The existing mapping table remains temporarily for compatibility while the
-- application is migrated, but a question can no longer be mapped to multiple banks.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.question_bank_questions
    GROUP BY question_id
    HAVING COUNT(DISTINCT question_bank_id) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce single-bank question ownership: cross-bank question mappings exist';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_question_bank_questions_question
  ON public.question_bank_questions(question_id);

COMMENT ON INDEX public.uq_question_bank_questions_question IS
  'A question belongs to exactly one question bank. Cross-bank question sharing is forbidden.';
