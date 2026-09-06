-- New code should use user_question_flags. Keep the legacy column temporarily for
-- compatibility with unfinished/WIP UI until application migration is complete.
ALTER TABLE public.user_answers
    ALTER COLUMN is_flagged SET DEFAULT FALSE;
