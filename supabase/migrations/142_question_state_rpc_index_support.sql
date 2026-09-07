CREATE INDEX IF NOT EXISTS idx_user_answers_session_question_user
ON public.user_answers(test_session_id, question_id, user_id);
