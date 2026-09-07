CREATE INDEX IF NOT EXISTS idx_user_answers_session_correct
ON public.user_answers(test_session_id, is_correct);
