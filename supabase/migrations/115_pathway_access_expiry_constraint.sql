ALTER TABLE public.user_pathway_access
    DROP CONSTRAINT IF EXISTS user_pathway_access_blocks_allowed_nonnegative;
ALTER TABLE public.user_pathway_access
    ADD CONSTRAINT user_pathway_access_blocks_allowed_nonnegative
    CHECK (blocks_allowed >= 0);
