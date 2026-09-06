-- Protect question-state counting from duplicate rows. A question may be present at
-- most once in a session, and a session has at most one mutable/final answer row per
-- question. Timed mode should UPDATE that row until End Block rather than INSERTing
-- duplicate attempts.

DELETE FROM public.user_answers a
USING public.user_answers b
WHERE a.test_session_id = b.test_session_id
  AND a.question_id = b.question_id
  AND a.id < b.id;

ALTER TABLE public.user_answers
    ADD CONSTRAINT user_answers_session_question_key
    UNIQUE (test_session_id, question_id);

DO $$
BEGIN
    IF to_regclass('public.test_session_questions') IS NOT NULL THEN
        DELETE FROM public.test_session_questions a
        USING public.test_session_questions b
        WHERE a.test_session_id = b.test_session_id
          AND a.question_id = b.question_id
          AND a.ctid < b.ctid;

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
    END IF;
END;
$$;
