COMMENT ON COLUMN public.user_answers.answered_at IS
'Server-stamped when an answer selection is persisted/changed. Latest answered_at (then id) determines current Correct/Incorrect state across sessions.';
