-- Do not auto-invent a correct answer. Surface bad imported content explicitly.
DO $$
DECLARE
    missing_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO missing_count
    FROM public.questions q
    WHERE NOT EXISTS (
        SELECT 1 FROM public.options o
        WHERE o.question_id = q.id AND o.is_correct = TRUE
    );

    IF missing_count > 0 THEN
        RAISE NOTICE '% questions currently have no correct option; fix ingestion data before production.', missing_count;
    END IF;
END;
$$;
