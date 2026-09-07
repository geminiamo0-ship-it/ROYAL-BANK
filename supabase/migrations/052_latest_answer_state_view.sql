-- Correct/Incorrect is determined by the latest finalized answer for each
-- user/question. This view is the canonical state source for filters/statistics.

CREATE OR REPLACE VIEW public.user_latest_answer_state
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (ua.user_id, ua.question_id)
    ua.user_id,
    ua.question_id,
    ua.test_session_id,
    ua.selected_option_id,
    ua.is_correct,
    ua.time_spent_seconds,
    ua.answered_at
FROM public.user_answers ua
ORDER BY ua.user_id, ua.question_id, ua.answered_at DESC, ua.id DESC;
