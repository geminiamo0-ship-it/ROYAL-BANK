-- Protect question-state counting from duplicate rows. A question may be present at
-- most once in a session, and a session has at most one mutable/final answer row per
-- question. Timed mode should UPDATE that row until End Block rather than INSERTing
-- duplicate attempts.

CREATE TABLE IF NOT EXISTS public.test_session_questions (
    test_session_id UUID NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,
    question_id BIGINT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE public.test_session_questions
    ADD COLUMN IF NOT EXISTS sort_order INT;
UPDATE public.test_session_questions SET sort_order = 0 WHERE sort_order IS NULL;
ALTER TABLE public.test_session_questions
    ALTER COLUMN sort_order SET DEFAULT 0,
    ALTER COLUMN sort_order SET NOT NULL;

DELETE FROM public.user_answers a
USING public.user_answers b
WHERE a.test_session_id = b.test_session_id
  AND a.question_id = b.question_id
  AND a.id < b.id;

ALTER TABLE public.user_answers
    ADD CONSTRAINT user_answers_session_question_key
    UNIQUE (test_session_id, question_id);

DELETE FROM public.test_session_questions a
USING public.test_session_questions b
WHERE a.test_session_id = b.test_session_id
  AND a.question_id = b.question_id
  AND a.ctid < b.ctid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.test_session_questions'::regclass
          AND conname = 'test_session_questions_session_question_key'
    ) THEN
        ALTER TABLE public.test_session_questions
            ADD CONSTRAINT test_session_questions_session_question_key
            UNIQUE (test_session_id, question_id);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_test_session_questions_session_sort
    ON public.test_session_questions(test_session_id, sort_order);
