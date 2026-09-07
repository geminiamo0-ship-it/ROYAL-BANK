UPDATE public.test_sessions
SET difficulty_filter = ARRAY(
    SELECT DISTINCT d
    FROM unnest(COALESCE(difficulty_filter, ARRAY[]::TEXT[])) AS d
    WHERE d IN ('1','2','3')
)
WHERE difficulty_filter IS NOT NULL;

ALTER TABLE public.test_sessions
    DROP CONSTRAINT IF EXISTS test_sessions_difficulty_filter_check;
ALTER TABLE public.test_sessions
    ADD CONSTRAINT test_sessions_difficulty_filter_check
    CHECK (
        difficulty_filter IS NULL
        OR difficulty_filter <@ ARRAY['1','2','3']::TEXT[]
    );
