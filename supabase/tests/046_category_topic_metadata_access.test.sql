BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.get_category_topic_counts(integer)', 'EXECUTE'),
    'anon cannot execute category/topic count RPC'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_category_topic_counts_json'
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    0,
    'anon cannot execute any category/topic JSON overload'
);

SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.get_category_topic_counts(integer)', 'EXECUTE'),
    'authenticated retains category/topic count RPC access subject to bank authorization'
);

SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.get_category_topic_counts_json(bigint)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.get_category_topic_counts_json(integer)', 'EXECUTE'),
    'authenticated retains both JSON overloads subject to bank authorization'
);

INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '46000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'metadata-allowed@test.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '46000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'metadata-denied@test.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.pathways(id, name, slug)
VALUES (14601, 'Metadata Access Pathway', 'test-metadata-access-pathway');

INSERT INTO public.question_banks(id, pathway_id, name, is_free_trial, free_trial_block_limit)
VALUES (14602, 14601, 'Metadata Access Bank', FALSE, NULL);

INSERT INTO public.user_access_grants(user_id, scope_type, question_bank_id)
VALUES ('46000000-0000-0000-0000-000000000001', 'bank', 14602);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '46000000-0000-0000-0000-000000000002', true);

SELECT extensions.throws_ok(
    $$SELECT count(*) FROM public.get_category_topic_counts(14602)$$,
    'Question bank access denied',
    'count metadata rejects an authenticated user without bank access'
);

SELECT extensions.throws_ok(
    $$SELECT public.get_category_topic_counts_json(14602::bigint)$$,
    'Question bank access denied',
    'bigint JSON metadata rejects an authenticated user without bank access'
);

SELECT extensions.throws_ok(
    $$SELECT public.get_category_topic_counts_json(14602::integer)$$,
    'Question bank access denied',
    'integer JSON metadata rejects an authenticated user without bank access'
);

SELECT set_config('request.jwt.claim.sub', '46000000-0000-0000-0000-000000000001', true);

SELECT extensions.lives_ok(
    $$SELECT count(*) FROM public.get_category_topic_counts(14602)$$,
    'authorized bank user can read category/topic count metadata'
);

SELECT extensions.lives_ok(
    $$SELECT public.get_category_topic_counts_json(14602::bigint)$$,
    'authorized bank user can read bigint JSON metadata'
);

SELECT extensions.lives_ok(
    $$SELECT public.get_category_topic_counts_json(14602::integer)$$,
    'authorized bank user can read integer JSON metadata'
);

SELECT * FROM extensions.finish();
ROLLBACK;
