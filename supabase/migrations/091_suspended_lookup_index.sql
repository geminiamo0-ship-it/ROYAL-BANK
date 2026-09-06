CREATE INDEX IF NOT EXISTS idx_tsq_question_session
ON public.test_session_questions(question_id, test_session_id);
