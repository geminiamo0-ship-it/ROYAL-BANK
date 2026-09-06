COMMENT ON TABLE public.test_session_questions IS
'Locked exam question set. Authenticated clients have read-only RLS access; writes are reserved for trusted session-creation database functions.';
