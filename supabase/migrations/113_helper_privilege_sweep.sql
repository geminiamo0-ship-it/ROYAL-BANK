REVOKE ALL ON FUNCTION public.can_access_question_bank(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_question(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_locked_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_support_or_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_access_question_bank(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_question(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_locked_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_support_or_admin() TO authenticated;
