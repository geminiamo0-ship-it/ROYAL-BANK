-- Trial ledger is operational history. Keep current cascade semantics while the
-- project is pre-production; revisit retention/anonymization policy before launch.
COMMENT ON COLUMN public.free_trial_block_usage.user_id IS
'Owner of trial consumption. Current pre-production schema cascades on profile deletion; define production retention policy before launch.';
