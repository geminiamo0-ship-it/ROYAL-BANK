BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.admin_get_revenue_summary(timestamptz,timestamptz)', 'EXECUTE'),
    'anon cannot execute admin revenue reporting'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.admin_list_promo_codes()', 'EXECUTE'),
    'anon cannot execute admin promo reporting'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.support_list_upgrade_requests(text,text,integer,integer)', 'EXECUTE'),
    'anon cannot execute support request listing'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.support_activate_upgrade(uuid)', 'EXECUTE'),
    'anon cannot execute support activation'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.partner_get_coupon_summary()', 'EXECUTE'),
    'anon cannot execute partner reporting'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.create_upgrade_request(text,bigint,bigint,text)', 'EXECUTE'),
    'anon cannot create authenticated upgrade requests'
);
SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.admin_get_revenue_summary(timestamptz,timestamptz)', 'EXECUTE'),
    'authenticated sessions retain RPC reachability for server-side admin role checks'
);
SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.support_activate_upgrade(uuid)', 'EXECUTE'),
    'authenticated sessions retain support RPC reachability for live role checks'
);
SELECT extensions.ok(
    NOT has_table_privilege('anon', 'public.question_bank_topic_counts', 'SELECT'),
    'anon cannot read raw topic-count materialized view'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.question_bank_topic_counts', 'SELECT'),
    'authenticated clients cannot bypass topic-count RPCs with direct materialized-view reads'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_category_topic_counts'
          AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    ),
    'category topic count function has a pinned search path'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_category_topic_counts_json'
          AND pg_get_function_identity_arguments(p.oid) = 'p_bank_id bigint'
          AND p.proconfig @> ARRAY['search_path=public, pg_temp']::text[]
    ),
    'bigint category topic count JSON function has a pinned search path'
);
SELECT extensions.ok(
    to_regclass('public.upgrade_requests_support_queue_idx') IS NOT NULL,
    'pre-existing support queue index remains available'
);
SELECT extensions.ok(
    to_regclass('public.idx_upgrade_requests_status_created_at') IS NULL,
    'duplicate Release C support queue index was removed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
