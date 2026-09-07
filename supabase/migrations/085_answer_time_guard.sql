ALTER TABLE public.user_answers
    DROP CONSTRAINT IF EXISTS user_answers_time_spent_nonnegative;
ALTER TABLE public.user_answers
    ADD CONSTRAINT user_answers_time_spent_nonnegative
    CHECK (time_spent_seconds >= 0);
