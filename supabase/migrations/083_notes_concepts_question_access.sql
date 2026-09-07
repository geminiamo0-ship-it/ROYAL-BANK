CREATE OR REPLACE FUNCTION public.validate_user_question_write_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_questions qbq
        WHERE qbq.question_id = NEW.question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    ) THEN
        RAISE EXCEPTION 'Question access denied';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_user_notes_question_access ON public.user_notes;
CREATE TRIGGER validate_user_notes_question_access
    BEFORE INSERT OR UPDATE OF user_id, question_id ON public.user_notes
    FOR EACH ROW EXECUTE FUNCTION public.validate_user_question_write_access();

DROP TRIGGER IF EXISTS validate_saved_concepts_question_access ON public.saved_concepts;
CREATE TRIGGER validate_saved_concepts_question_access
    BEFORE INSERT OR UPDATE OF user_id, question_id ON public.saved_concepts
    FOR EACH ROW EXECUTE FUNCTION public.validate_user_question_write_access();

REVOKE ALL ON FUNCTION public.validate_user_question_write_access() FROM PUBLIC;
