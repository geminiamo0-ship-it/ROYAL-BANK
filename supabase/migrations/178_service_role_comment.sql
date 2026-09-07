COMMENT ON FUNCTION public.admin_configure_bank_access(BIGINT, BOOLEAN, INT) IS
'Authenticated admin-only configuration boundary. Trusted ingestion/maintenance may use Supabase service role, which bypasses RLS by design and must remain server-only.';
