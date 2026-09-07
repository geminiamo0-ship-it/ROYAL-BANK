CREATE INDEX IF NOT EXISTS idx_user_answers_latest_state
ON public.user_answers(user_id, question_id, answered_at DESC, id DESC);
