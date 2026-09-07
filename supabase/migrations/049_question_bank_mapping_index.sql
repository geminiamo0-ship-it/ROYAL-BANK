CREATE INDEX IF NOT EXISTS idx_question_bank_questions_bank_question
ON public.question_bank_questions(question_bank_id, question_id);

CREATE INDEX IF NOT EXISTS idx_user_pathway_access_user_pathway_expiry
ON public.user_pathway_access(user_id, pathway_id, access_type, expires_at);
