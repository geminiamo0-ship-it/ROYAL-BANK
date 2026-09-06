ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_score_percentage_range;
ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_score_percentage_range
    CHECK (score_percentage IS NULL OR score_percentage BETWEEN 0 AND 100);
