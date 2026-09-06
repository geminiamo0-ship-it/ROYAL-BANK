-- Validate that an answer belongs to the session's locked question set and that
-- the selected option belongs to that same question. This closes ID-tampering
-- paths that row ownership alone cannot prevent.

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
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

DROP TRIGGER IF EXISTS validate_user_answer_relationships_trigger ON public.user_answers;
CREATE TRIGGER validate_user_answer_relationships_trigger
    BEFORE INSERT OR UPDATE OF test_session_id, question_id, selected_option_id
    ON public.user_answers
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_user_answer_relationships();
