COMMENT ON FUNCTION public.get_user_question_states(BIGINT) IS
'Application boundary for New/Correct/Incorrect/Suspended/Flagged state. Prefer this over rebuilding state from raw user_answers/test_session_questions in application code.';
