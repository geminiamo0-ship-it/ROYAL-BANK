COMMENT ON FUNCTION public.get_user_question_states(BIGINT) IS
'Canonical per-question state. Suspended uses DISTINCT question IDs across unfinished sessions, so a question is counted once even if legacy data contains multiple unfinished locks.';
