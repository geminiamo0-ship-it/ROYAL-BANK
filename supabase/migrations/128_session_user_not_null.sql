DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.test_sessions WHERE user_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot enforce session ownership: test_sessions contains NULL user_id';
    END IF;
END;
$$;

ALTER TABLE public.test_sessions
    ALTER COLUMN user_id SET NOT NULL;
