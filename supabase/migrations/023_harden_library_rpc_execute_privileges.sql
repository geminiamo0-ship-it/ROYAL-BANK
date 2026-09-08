REVOKE EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_library_articles(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_library_articles(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_library_articles(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) TO authenticated;
