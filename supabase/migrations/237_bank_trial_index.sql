CREATE INDEX IF NOT EXISTS idx_question_banks_trial
ON public.question_banks(id)
WHERE is_free_trial = TRUE;
