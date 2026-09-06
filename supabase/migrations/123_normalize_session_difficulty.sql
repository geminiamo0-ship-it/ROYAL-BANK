UPDATE public.test_sessions
SET difficulty_filter = ARRAY(
    SELECT DISTINCT d
    FROM unnest(COALESCE(difficulty_filter, ARRAY[]::TEXT[])) AS d
    WHERE d IN ('1','2','3')
)
WHERE difficulty_filter IS NOT NULL;
