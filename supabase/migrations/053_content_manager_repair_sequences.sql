-- Repair legacy sequences before Content Manager writes generated IDs.
-- Historical question/option content was loaded with explicit IDs, so the
-- backing sequences can lag far behind MAX(id). That causes generated option
-- inserts to collide with existing primary keys during Production imports.

SELECT setval(
    'public.options_id_seq'::regclass,
    GREATEST(COALESCE((SELECT MAX(id) FROM public.options), 1), 1),
    EXISTS (SELECT 1 FROM public.options)
);

SELECT setval(
    'public.questions_id_seq'::regclass,
    GREATEST(COALESCE((SELECT MAX(id) FROM public.questions), 1), 1),
    EXISTS (SELECT 1 FROM public.questions)
);
