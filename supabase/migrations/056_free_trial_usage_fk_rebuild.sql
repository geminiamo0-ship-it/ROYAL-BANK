-- Rebuild the ledger's session reference in one valid order. This supersedes the
-- transitional 043/044 migrations and is idempotent on databases where they ran.

ALTER TABLE public.free_trial_block_usage
    ALTER COLUMN test_session_id DROP NOT NULL;

ALTER TABLE public.free_trial_block_usage
    DROP CONSTRAINT IF EXISTS free_trial_block_usage_session_fk;

ALTER TABLE public.free_trial_block_usage
    ADD CONSTRAINT free_trial_block_usage_session_fk
    FOREIGN KEY (test_session_id)
    REFERENCES public.test_sessions(id)
    ON DELETE SET NULL;
