ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_difficulty_filter_check;
ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_difficulty_filter_check
    CHECK (
        difficulty_filter IS NULL
        OR difficulty_filter <@ ARRAY['1','2','3']::TEXT[]
    );
