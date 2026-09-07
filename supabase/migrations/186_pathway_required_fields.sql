UPDATE public.pathways SET name = 'Pathway ' || id::text WHERE name IS NULL OR btrim(name) = '';
UPDATE public.pathways SET slug = 'pathway-' || id::text WHERE slug IS NULL OR btrim(slug) = '';
ALTER TABLE public.pathways ALTER COLUMN name SET NOT NULL, ALTER COLUMN slug SET NOT NULL;
