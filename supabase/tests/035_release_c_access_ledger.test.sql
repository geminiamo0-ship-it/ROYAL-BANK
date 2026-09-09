BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','ledger-user@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','ledger-admin@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles
SET role = 'admin'
WHERE id = '35000000-0000-0000-0000-000000000002';

INSERT INTO public.user_access_grants (
    user_id,scope_type,starts_at,expires_at,granted_by
) VALUES (
    '35000000-0000-0000-0000-000000000001',
    'global',now(),now() + interval '45 days',
    '35000000-0000-0000-0000-000000000002'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','35000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_access_grants(NULL,NULL,200,0)$$,
    'ADMIN_ACCESS_REQUIRED',
    'student cannot inspect the centralized access ledger'
);

SELECT set_config('request.jwt.claim.sub','35000000-0000-0000-0000-000000000002',true);

SELECT extensions.is(
    (
        SELECT COUNT(*)::INTEGER
        FROM public.admin_list_access_grants('ledger-user@test.local','active',200,0)
    ),
    1,
    'admin can filter the access ledger by user and active status'
);

SELECT extensions.is(
    (
        SELECT scope_name
        FROM public.admin_list_access_grants('ledger-user@test.local','active',200,0)
        LIMIT 1
    ),
    'All Royal access',
    'global access has a readable scope label'
);

RESET ROLE;

SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.admin_list_access_grants(text,text,integer,integer)',
        'EXECUTE'
    ),
    'anonymous callers cannot execute the access ledger RPC'
);

SELECT * FROM extensions.finish();
ROLLBACK;
