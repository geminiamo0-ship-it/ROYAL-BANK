CREATE INDEX IF NOT EXISTS idx_user_answers_user_answered_question
ON public.user_answers(user_id, answered_at DESC, question_id, id DESC);
