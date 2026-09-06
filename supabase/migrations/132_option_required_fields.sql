DELETE FROM public.options WHERE question_id IS NULL;
ALTER TABLE public.options ALTER COLUMN question_id SET NOT NULL;
