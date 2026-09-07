DO $$
DECLARE
    unmapped_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO unmapped_count
    FROM public.questions q
    WHERE NOT EXISTS (
        SELECT 1 FROM public.question_bank_questions qbq WHERE qbq.question_id = q.id
    );

    IF unmapped_count > 0 THEN
        RAISE NOTICE '% questions are not mapped to any bank and are intentionally inaccessible under hardened RLS.', unmapped_count;
    END IF;
END;
$$;
