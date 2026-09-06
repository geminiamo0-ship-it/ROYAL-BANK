-- The legacy latest-answer view contains selected_option_id and is_correct.
-- Browser clients must use the gated exam/state RPCs instead of reading it directly.
REVOKE ALL ON TABLE public.user_latest_answer_state FROM PUBLIC;
REVOKE ALL ON TABLE public.user_latest_answer_state FROM anon;
REVOKE ALL ON TABLE public.user_latest_answer_state FROM authenticated;

COMMENT ON VIEW public.user_latest_answer_state IS
'Internal latest-answer projection. Client access is intentionally revoked; use get_user_question_states/get_exam_session_answers/get_exam_question_feedback.';
