ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_total_questions_range;
ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_total_questions_range
    CHECK (total_questions BETWEEN 0 AND 70);
