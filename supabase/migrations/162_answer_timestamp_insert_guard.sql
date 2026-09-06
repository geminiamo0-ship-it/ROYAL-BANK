DROP TRIGGER IF EXISTS c_set_answer_server_timestamp ON public.user_answers;
CREATE TRIGGER c_set_answer_server_timestamp
    BEFORE INSERT OR UPDATE OF selected_option_id ON public.user_answers
    FOR EACH ROW EXECUTE FUNCTION public.set_answer_server_timestamp();
