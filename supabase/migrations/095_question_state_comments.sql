COMMENT ON FUNCTION public.get_user_question_states(BIGINT) IS
'Canonical question state: latest finalized answer determines correct/incorrect; suspended means unanswered lock in unfinished session; new excludes answered and suspended; flagged is persistent user-question state.';
