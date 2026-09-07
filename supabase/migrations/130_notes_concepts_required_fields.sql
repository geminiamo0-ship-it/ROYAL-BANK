DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.user_notes WHERE user_id IS NULL OR question_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot enforce note ownership: NULL owner/question';
    END IF;
    IF EXISTS (SELECT 1 FROM public.saved_concepts WHERE user_id IS NULL OR question_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot enforce concept ownership: NULL owner/question';
    END IF;
END;
$$;

ALTER TABLE public.user_notes
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN question_id SET NOT NULL;

ALTER TABLE public.saved_concepts
    ALTER COLUMN user_id SET NOT NULL,
    ALTER COLUMN question_id SET NOT NULL;
