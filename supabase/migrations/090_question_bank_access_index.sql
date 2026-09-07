CREATE INDEX IF NOT EXISTS idx_question_banks_pathway_trial
ON public.question_banks(pathway_id, is_free_trial, id);
