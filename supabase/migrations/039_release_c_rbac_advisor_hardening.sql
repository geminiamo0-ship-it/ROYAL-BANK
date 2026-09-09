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

-- Production currently has an additional bigint overload that is not part of a fresh
-- migration rebuild. Harden every existing overload instead of assuming environments
-- have exactly the same historical function signatures.
DO $$
DECLARE
    function_row RECORD;
BEGIN
    FOR function_row IN
        SELECT p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('get_category_topic_counts', 'get_category_topic_counts_json')
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %s SET search_path TO %L, %L',
            function_row.signature,
            'public',
            'pg_temp'
        );
    END LOOP;
END;
$$;

-- The application uses the supported topic-count RPC surface, not direct materialized
-- view reads. If the view exists in this environment, keep raw rows out of Data API.
DO $$
BEGIN
    IF to_regclass('public.question_bank_topic_counts') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.question_bank_topic_counts FROM anon, authenticated;
    END IF;
END;
$$;

-- 036 introduced an index identical to the pre-existing support queue index.
-- Keep the established index and remove the duplicate write/storage overhead.
DROP INDEX IF EXISTS public.idx_upgrade_requests_status_created_at;
