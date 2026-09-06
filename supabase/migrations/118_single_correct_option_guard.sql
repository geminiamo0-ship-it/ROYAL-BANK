CREATE UNIQUE INDEX IF NOT EXISTS idx_options_one_correct_per_question
ON public.options(question_id)
WHERE is_correct = TRUE;
