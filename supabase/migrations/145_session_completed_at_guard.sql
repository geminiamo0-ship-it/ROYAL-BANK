CREATE OR REPLACE FUNCTION public.enforce_test_session_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.question_bank_id IS DISTINCT FROM OLD.question_bank_id
       OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
        RAISE EXCEPTION 'Session ownership, bank, and start time are immutable';
    END IF;

    IF OLD.is_completed AND NOT NEW.is_completed THEN
        RAISE EXCEPTION 'Completed sessions cannot be reopened';
    END IF;

    IF OLD.is_completed AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
        RAISE EXCEPTION 'Completion time is immutable';
    END IF;

    IF NEW.is_completed AND NOT OLD.is_completed THEN
        NEW.completed_at := timezone('utc'::text, now());
    ELSEIF NOT NEW.is_completed THEN
        NEW.completed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;
