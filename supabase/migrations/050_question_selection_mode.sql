ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_question_selection_check;

ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_question_selection_check
    CHECK (question_selection IN ('new_only', 'incorrect_only', 'all', 'flagged_only', 'suspended_only'));
