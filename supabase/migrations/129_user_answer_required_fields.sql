DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.user_answers
        WHERE test_session_id IS NULL OR user_id IS NULL OR question_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot enforce answer ownership: required answer fields contain NULL';
    END IF;
END;
$$;

ALTER TABLE public.user_answers
    ALTER COLUMN test_session_id SET NOT NULL,
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN question_id SET NOT NULL,
    ALTER COLUMN is_correct SET NOT NULL,
    ALTER COLUMN time_spent_seconds SET NOT NULL;
