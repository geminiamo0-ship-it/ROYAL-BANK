BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '34000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','release-c-student@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '34000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','release-c-support@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '34000000-0000-0000-0000-000000000003',
    'authenticated','authenticated','release-c-admin@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles
SET role = CASE
    WHEN id = '34000000-0000-0000-0000-000000000002' THEN 'support'
    WHEN id = '34000000-0000-0000-0000-000000000003' THEN 'admin'
    ELSE role
END
WHERE id IN (
    '34000000-0000-0000-0000-000000000002',
    '34000000-0000-0000-0000-000000000003'
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9840,'Release C Test Pathway','release-c-test-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES (
    9841,9840,'Release C Test Bank',FALSE,NULL,70,10
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','34000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_users(NULL,NULL,NULL,100,0)$$,
    'ADMIN_ACCESS_REQUIRED',
    'students cannot use admin user search'
);

SELECT set_config('request.jwt.claim.sub','34000000-0000-0000-0000-000000000002',true);

SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_users(NULL,NULL,NULL,100,0)$$,
    'ADMIN_ACCESS_REQUIRED',
    'support cannot use admin-only user administration'
);

SELECT set_config('request.jwt.claim.sub','34000000-0000-0000-0000-000000000003',true);

SELECT extensions.is(
    (
        SELECT COUNT(*)::INTEGER
        FROM public.admin_list_users('release-c-student@test.local','student',TRUE,100,0)
    ),
    1,
    'admin can search live users with filters'
);

SELECT extensions.is(
    public.admin_get_user_detail('34000000-0000-0000-0000-000000000001')->'profile'->>'email',
    'release-c-student@test.local',
    'admin can open a user detail record'
);

SELECT extensions.is(
    (public.admin_update_user_access(
        '34000000-0000-0000-0000-000000000001',NULL,NULL,FALSE
    )).is_active,
    FALSE,
    'admin can suspend a user'
);

SELECT extensions.is(
    (public.admin_update_user_access(
        '34000000-0000-0000-0000-000000000001',NULL,NULL,TRUE
    )).is_active,
    TRUE,
    'admin can reactivate a user'
);

SELECT extensions.is(
    public.admin_grant_user_access(
        '34000000-0000-0000-0000-000000000001',
        'bank',NULL,9841,now(),now() + interval '30 days'
    )->>'scope_type',
    'bank',
    'admin can grant scoped premium access'
);

SELECT extensions.is(
    (
        SELECT COUNT(*)::INTEGER
        FROM public.user_access_grants
        WHERE user_id = '34000000-0000-0000-0000-000000000001'
          AND question_bank_id = 9841
          AND revoked_at IS NULL
    ),
    1,
    'manual grant writes to the authoritative access ledger'
);

SELECT extensions.ok(
    (
        public.admin_extend_user_access(
            (
                SELECT id FROM public.user_access_grants
                WHERE user_id = '34000000-0000-0000-0000-000000000001'
                  AND question_bank_id = 9841
                ORDER BY id DESC LIMIT 1
            ),
            now() + interval '90 days'
        )->>'expires_at'
    )::TIMESTAMPTZ > now() + interval '80 days',
    'admin can extend a dated access grant'
);

SELECT extensions.is(
    public.admin_revoke_user_access(
        (
            SELECT id FROM public.user_access_grants
            WHERE user_id = '34000000-0000-0000-0000-000000000001'
              AND question_bank_id = 9841
            ORDER BY id DESC LIMIT 1
        ),
        'Release C revocation test'
    )->>'status',
    'revoked',
    'admin can soft-revoke access'
);

SELECT extensions.is(
    (
        SELECT revoke_reason
        FROM public.user_access_grants
        WHERE user_id = '34000000-0000-0000-0000-000000000001'
          AND question_bank_id = 9841
        ORDER BY id DESC LIMIT 1
    ),
    'Release C revocation test',
    'revocation reason is preserved for audit'
);

SELECT extensions.is(
    public.admin_get_user_detail('34000000-0000-0000-0000-000000000001')->'grants'->0->>'status',
    'revoked',
    'user detail exposes grant lifecycle status'
);

SELECT extensions.ok(
    (public.admin_get_operations_summary()->>'total_users')::BIGINT >= 3,
    'operations summary returns live user counts'
);

SELECT extensions.ok(
    public.admin_get_support_performance(now() - interval '30 days', now()) ? 'summary',
    'support performance returns a live summary payload'
);

RESET ROLE;

SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.admin_list_users(text,text,boolean,integer,integer)',
        'EXECUTE'
    ),
    'anonymous callers have no execute privilege on admin operations RPCs'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','34000000-0000-0000-0000-000000000003',true);

SELECT extensions.throws_ok(
    $$SELECT public.admin_update_user_access(
        '34000000-0000-0000-0000-000000000003','student',NULL,NULL
    )$$,
    'ADMIN_SELF_LOCKOUT',
    'an administrator cannot demote their own active account'
);

SELECT * FROM extensions.finish();
ROLLBACK;
