REVOKE ALL ON FUNCTION public.set_question_flag(BIGINT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_question_flag(BIGINT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_question_flag(BIGINT, BOOLEAN) TO authenticated;
