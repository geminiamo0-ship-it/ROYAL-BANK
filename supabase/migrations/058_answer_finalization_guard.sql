-- Standard/Tutor answers are final once submitted. Timed answers may be updated
-- until End Block (session completion), then become immutable.

CREATE OR REPLACE FUNCTION public.enforce_answer_finalization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    mode TEXT;
    completed BOOLEAN;
BEGIN
    SELECT ts.session_type, ts.is_completed
    INTO mode, completed
    FROM public.test_sessions ts
    WHERE ts.id = OLD.test_session_id
      AND ts.user_id = OLD.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF completed THEN
        RAISE EXCEPTION 'Answers cannot be changed after End Block';
    END IF;

    IF mode IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Submitted Standard/Tutor answers are final';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_answer_finalization_trigger ON public.user_answers;
CREATE TRIGGER enforce_answer_finalization_trigger
    BEFORE UPDATE ON public.user_answers
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_answer_finalization();

REVOKE ALL ON FUNCTION public.enforce_answer_finalization() FROM PUBLIC;
