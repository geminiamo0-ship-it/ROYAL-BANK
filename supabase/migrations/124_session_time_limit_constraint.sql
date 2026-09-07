UPDATE public.test_sessions
SET time_limit_minutes = NULL
WHERE time_limit_minutes IS NOT NULL AND time_limit_minutes <= 0;

ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_time_limit_positive;
ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_time_limit_positive
    CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0);
