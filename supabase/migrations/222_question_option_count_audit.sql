DO $$
DECLARE
    malformed_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO malformed_count
    FROM public.questions q
    LEFT JOIN public.options o ON o.question_id = q.id
    GROUP BY q.id
    HAVING COUNT(o.id) < 2
    LIMIT 1;

    IF malformed_count IS NOT NULL THEN
        RAISE NOTICE 'At least one question has fewer than two options; fix ingestion data before production.';
    END IF;
END;
$$;
