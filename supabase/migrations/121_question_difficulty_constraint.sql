UPDATE public.questions
SET difficulty = '1'
WHERE difficulty IS NULL OR difficulty NOT IN ('1', '2', '3');

ALTER TABLE public.questions
    DROP CONSTRAINT IF EXISTS questions_difficulty_check;
ALTER TABLE public.questions
    ADD CONSTRAINT questions_difficulty_check
    CHECK (difficulty IN ('1', '2', '3'));
