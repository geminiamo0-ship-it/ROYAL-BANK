DO $$
DECLARE
    bad_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO bad_count
    FROM public.question_banks qb
    WHERE qb.is_free_trial = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM public.question_bank_questions qbq WHERE qbq.question_bank_id = qb.id
      );

    IF bad_count > 0 THEN
        RAISE NOTICE '% trial banks have no mapped questions.', bad_count;
    END IF;
END;
$$;
