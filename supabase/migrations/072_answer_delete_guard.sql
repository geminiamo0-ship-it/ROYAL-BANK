-- Answers are exam history. Users may delete an entire session (which cascades its
-- answers) but should not selectively erase finalized answer rows.

CREATE OR REPLACE FUNCTION public.prevent_direct_answer_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    -- A cascading session delete no longer has a parent session row by the time the
    -- child trigger checks it. Allow that path; reject standalone answer deletion.
    IF EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = OLD.test_session_id
    ) THEN
        RAISE EXCEPTION 'Individual finalized answers cannot be deleted';
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_direct_answer_delete_trigger ON public.user_answers;
CREATE TRIGGER prevent_direct_answer_delete_trigger
    BEFORE DELETE ON public.user_answers
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_direct_answer_delete();

REVOKE ALL ON FUNCTION public.prevent_direct_answer_delete() FROM PUBLIC;
