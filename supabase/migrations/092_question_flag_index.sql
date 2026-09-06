CREATE INDEX IF NOT EXISTS idx_user_question_flags_user_question
ON public.user_question_flags(user_id, question_id);
