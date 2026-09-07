DELETE FROM public.question_bank_questions
WHERE question_bank_id IS NULL OR question_id IS NULL;

ALTER TABLE public.question_bank_questions
    ALTER COLUMN question_bank_id SET NOT NULL,
    ALTER COLUMN question_id SET NOT NULL;
