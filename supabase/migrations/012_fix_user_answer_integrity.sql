-- Replace the answer RLS subquery with a simple ownership policy and enforce the
-- cross-table session ownership invariant in a trigger. This avoids RLS
-- recursion/visibility surprises while keeping the invariant database-side.

DROP POLICY IF EXISTS "Users have full access to own answers" ON public.user_answers;
CREATE POLICY "Users have full access to own answers"
    ON public.user_answers FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.test_sessions ts
        WHERE ts.id = NEW.test_session_id
          AND ts.user_id = NEW.user_id
          AND ts.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    IF NEW.selected_option_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id
    ) THEN
        RAISE EXCEPTION 'Selected option does not belong to question';
    END IF;

    IF to_regclass('public.test_session_questions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM public.test_session_questions tsq
            WHERE tsq.test_session_id = NEW.test_session_id
              AND tsq.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    RETURN NEW;
END;
$$;
