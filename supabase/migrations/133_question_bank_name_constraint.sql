UPDATE public.question_banks SET name = 'Bank ' || id::text WHERE name IS NULL OR btrim(name) = '';
ALTER TABLE public.question_banks ALTER COLUMN name SET NOT NULL;
