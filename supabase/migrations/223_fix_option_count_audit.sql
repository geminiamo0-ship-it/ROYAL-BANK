DO $$
DECLARE
    malformed_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO malformed_count
    FROM (
        SELECT q.id
        FROM public.questions q
        LEFT JOIN public.options o ON o.question_id = q.id
        GROUP BY q.id
        HAVING COUNT(o.id) < 2
    ) malformed;

    IF malformed_count > 0 THEN
        RAISE NOTICE '% questions have fewer than two options; fix ingestion data before production.', malformed_count;
    END IF;
END;
$$;
