-- user_question_flags is now the canonical flag state. Historical answer rows keep
-- their original data for migration/history but are not the source of current flag
-- filters.

COMMENT ON COLUMN public.user_answers.is_flagged IS
'Legacy snapshot only. Current persistent flag state lives in public.user_question_flags.';
