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
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.test_session_id IS DISTINCT FROM OLD.test_session_id
       OR NEW.question_id IS DISTINCT FROM OLD.question_id THEN
        RAISE EXCEPTION 'Answer ownership and question fields are immutable';
    END IF;

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
