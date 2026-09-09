-- Release C follow-up hardening after production database-advisor review.
-- Privileged business/admin/support/partner RPCs must never be executable by anon.
-- Signed-in callers keep EXECUTE because each privileged RPC performs its own live
-- role/ownership check server-side.

DO $$
DECLARE
    function_row RECORD;
BEGIN
    FOR function_row IN
        SELECT p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (
              p.proname LIKE 'admin\_%' ESCAPE '\'
              OR p.proname LIKE 'support\_%' ESCAPE '\'
              OR p.proname LIKE 'partner\_%' ESCAPE '\'
              OR p.proname IN (
                  'create_upgrade_request',
                  'get_my_active_access_grants',
                  'grant_user_access',
                  'revoke_user_access'
              )
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', function_row.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', function_row.signature);
    END LOOP;
END;
$$;

-- These topic-count RPCs are exposed from the public schema; pin their search path
-- so SECURITY DEFINER name resolution cannot be influenced by caller-controlled schemas.
ALTER FUNCTION public.get_category_topic_counts(INTEGER)
    SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.get_category_topic_counts_json(BIGINT)
    SET search_path TO 'public', 'pg_temp';

-- The app does not read the materialized view directly. Keep it behind the existing
-- SECURITY DEFINER topic-count RPCs instead of exposing raw rows through Data API.
REVOKE ALL ON TABLE public.question_bank_topic_counts FROM anon, authenticated;

-- 036 introduced an index identical to the pre-existing support queue index.
-- Keep the established index and remove the duplicate write/storage overhead.
DROP INDEX IF EXISTS public.idx_upgrade_requests_status_created_at;
