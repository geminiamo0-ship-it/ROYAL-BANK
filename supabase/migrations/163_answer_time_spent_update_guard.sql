-- time_spent_seconds is allowed to change with timed-mode answer updates, but the
-- finalization trigger prevents edits in Standard/Tutor and after End Block.
COMMENT ON COLUMN public.user_answers.time_spent_seconds IS
'Client-measured duration, constrained non-negative; mutable only while the answer itself remains editable.';
