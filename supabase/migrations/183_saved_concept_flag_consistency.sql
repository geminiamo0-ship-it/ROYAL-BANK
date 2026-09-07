UPDATE public.saved_concepts SET is_important = TRUE WHERE is_important IS NULL;
ALTER TABLE public.saved_concepts ALTER COLUMN is_important SET NOT NULL;
