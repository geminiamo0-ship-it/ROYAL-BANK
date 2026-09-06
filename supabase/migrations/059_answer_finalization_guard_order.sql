-- Reject forbidden updates before the integrity trigger performs any work.

DROP TRIGGER IF EXISTS enforce_answer_finalization_trigger ON public.user_answers;
CREATE TRIGGER a_enforce_answer_finalization_trigger
    BEFORE UPDATE ON public.user_answers
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_answer_finalization();

DROP TRIGGER IF EXISTS validate_user_answer_relationships_trigger ON public.user_answers;
CREATE TRIGGER b_validate_user_answer_relationships_trigger
    BEFORE INSERT OR UPDATE OF test_session_id, question_id, selected_option_id, is_correct
    ON public.user_answers
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_user_answer_relationships();
