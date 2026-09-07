-- Keep the usage row after a session is deleted, while retaining referential
-- integrity for sessions that still exist.

ALTER TABLE public.free_trial_block_usage
    ADD CONSTRAINT free_trial_block_usage_session_fk
    FOREIGN KEY (test_session_id)
    REFERENCES public.test_sessions(id)
    ON DELETE SET NULL;

ALTER TABLE public.free_trial_block_usage
    ALTER COLUMN test_session_id DROP NOT NULL;
