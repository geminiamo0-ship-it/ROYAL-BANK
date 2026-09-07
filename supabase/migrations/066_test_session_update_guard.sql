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

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_test_session_update_integrity_trigger ON public.test_sessions;
CREATE TRIGGER enforce_test_session_update_integrity_trigger
    BEFORE UPDATE ON public.test_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_test_session_update_integrity();

REVOKE ALL ON FUNCTION public.enforce_test_session_update_integrity() FROM PUBLIC;
