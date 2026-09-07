-- New sessions must always be tied to a bank. Preserve any historical NULL rows
-- rather than deleting them; enforce this invariant with a trigger for new writes.

CREATE OR REPLACE FUNCTION public.require_test_session_bank()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.question_bank_id IS NULL THEN
        RAISE EXCEPTION 'Exam session requires a question bank';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_test_session_bank_trigger ON public.test_sessions;
CREATE TRIGGER require_test_session_bank_trigger
    BEFORE INSERT OR UPDATE OF question_bank_id ON public.test_sessions
    FOR EACH ROW EXECUTE FUNCTION public.require_test_session_bank();

REVOKE ALL ON FUNCTION public.require_test_session_bank() FROM PUBLIC;
