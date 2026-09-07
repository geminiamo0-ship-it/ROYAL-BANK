REVOKE ALL ON FUNCTION public.update_my_profile(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_profile(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.grant_user_pathway_access(UUID, BIGINT, TEXT, INT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_user_pathway_access(UUID, BIGINT, TEXT, INT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_user_pathway_access(UUID, BIGINT, TEXT, INT, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_configure_bank_access(BIGINT, BOOLEAN, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_configure_bank_access(BIGINT, BOOLEAN, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_configure_bank_access(BIGINT, BOOLEAN, INT) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_question_states(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_question_states(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_question_states(BIGINT) TO authenticated;
