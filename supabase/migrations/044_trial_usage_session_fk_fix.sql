-- PostgreSQL requires the referencing column to be nullable before an ON DELETE
-- SET NULL foreign key can be useful.

ALTER TABLE public.free_trial_block_usage
    ALTER COLUMN test_session_id DROP NOT NULL;

ALTER TABLE public.free_trial_block_usage
    DROP CONSTRAINT IF EXISTS free_trial_block_usage_session_fk;

ALTER TABLE public.free_trial_block_usage
    ADD CONSTRAINT free_trial_block_usage_session_fk
    FOREIGN KEY (test_session_id)
    REFERENCES public.test_sessions(id)
    ON DELETE SET NULL;
