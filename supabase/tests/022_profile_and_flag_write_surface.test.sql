BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.profiles','UPDATE'),
    'authenticated cannot directly update profiles'
);
SELECT extensions.ok(
    NOT has_table_privilege('anon','public.profiles','UPDATE'),
    'anon cannot directly update profiles'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.user_question_flags','INSERT'),
    'authenticated cannot directly insert question flags'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.user_question_flags','UPDATE'),
    'authenticated cannot directly update question flags'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.user_question_flags','DELETE'),
    'authenticated cannot directly delete question flags'
);

SELECT extensions.ok(
    has_function_privilege('authenticated','public.update_my_profile(text,text)'::regprocedure,'EXECUTE'),
    'narrow self-profile RPC remains available'
);
SELECT extensions.ok(
    has_function_privilege('authenticated','public.admin_update_user_access(uuid,text,text,boolean)'::regprocedure,'EXECUTE'),
    'admin profile-management RPC remains callable and enforces its own role check'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f5000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','profile-hardening@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Original Name"}'::jsonb,now(),now()
);

SELECT extensions.is(
    (SELECT role FROM public.profiles WHERE id='f5000000-0000-0000-0000-000000000001'),
    'student',
    'new account begins as a student'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f5000000-0000-0000-0000-000000000001',true);

SELECT extensions.lives_ok(
    $$SELECT public.update_my_profile('Updated Name', NULL)$$,
    'user can still edit safe profile fields through the narrow RPC'
);

RESET ROLE;
SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id='f5000000-0000-0000-0000-000000000001'
          AND full_name='Updated Name'
          AND role='student'
          AND subscription_tier='free_trial'
          AND is_active=TRUE
    ),
    'safe profile edit cannot alter role, tier, or active state'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f5000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT public.admin_update_user_access(
        'f5000000-0000-0000-0000-000000000001'::uuid,
        'admin',
        'premium_full',
        TRUE
    )$$,
    'Admin access required',
    'a normal user cannot use the staff RPC to self-promote'
);

SELECT * FROM extensions.finish();
ROLLBACK;
