ALTER TABLE public.blocks
    DROP CONSTRAINT IF EXISTS blocks_max_questions_range;
ALTER TABLE public.blocks
    ADD CONSTRAINT blocks_max_questions_range
    CHECK (max_questions BETWEEN 1 AND 70);
