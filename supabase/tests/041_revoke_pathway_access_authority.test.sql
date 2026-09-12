BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','revoke-student@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','revoke-support@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000003',
    'authenticated','authenticated','revoke-admin@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000004',
    'authenticated','authenticated','all-banks-pathway@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles SET role='support' WHERE id='41000000-0000-0000-0000-000000000002';
UPDATE public.profiles SET role='admin' WHERE id='41000000-0000-0000-0000-000000000003';

INSERT INTO public.pathways (id,name,slug)
VALUES (94101,'Revoke Regression Pathway','revoke-regression-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES
    (94201,94101,'Revoke Regression Bank A',FALSE,NULL,70,10),
    (94202,94101,'Revoke Regression Bank B',FALSE,NULL,70,10);

INSERT INTO public.user_access_grants (
    user_id,scope_type,pathway_id,starts_at,expires_at
) VALUES (
    '41000000-0000-0000-0000-000000000001',
    'pathway',94101,now(),NULL
);

INSERT INTO public.user_access_grants (
    user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES
(
    '41000000-0000-0000-0000-000000000004',
    'bank',94201,now(),NULL
),
(
    '41000000-0000-0000-0000-000000000004',
    'bank',94202,now(),now()+interval '90 days'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    public.has_premium_question_bank_access(94201),
    'active pathway grant gives premium bank access before revoke'
);

SELECT extensions.ok(
    (public.resolve_my_access('pathway',94101,NULL)->>'has_access')::boolean
    AND public.resolve_my_access('pathway',94101,NULL)->>'coverage_kind'='exact',
    'pathway resolver reports the live pathway grant before revoke'
);

RESET ROLE;
UPDATE public.user_access_grants
SET revoked_at=now(),
    revoked_by='41000000-0000-0000-0000-000000000003',
    revoke_reason='regression revoke'
WHERE user_id='41000000-0000-0000-0000-000000000001'
  AND scope_type='pathway'
  AND pathway_id=94101;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    NOT public.has_premium_question_bank_access(94201),
    'revoked pathway grant no longer gives premium bank access'
);

SELECT extensions.ok(
    NOT (public.resolve_my_access('bank',NULL,94201)->>'has_access')::boolean,
    'bank resolver reports no access after pathway revoke'
);

SELECT extensions.ok(
    NOT (public.resolve_my_access('pathway',94101,NULL)->>'has_access')::boolean,
    'pathway resolver does not mistake missing bank grants for lifetime access'
);

SELECT extensions.ok(
    NOT public.can_access_question_bank(94201),
    'non-trial bank cannot be opened after the only premium grant is revoked'
);

SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000002',true);
SELECT extensions.ok(
    NOT public.has_premium_question_bank_access(94201),
    'support role is not itself a premium content entitlement'
);

SELECT extensions.ok(
    NOT (public.resolve_my_access('pathway',94101,NULL)->>'has_access')::boolean,
    'support role does not make the pathway appear activated without a grant'
);

SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000003',true);
SELECT extensions.ok(
    NOT public.has_premium_question_bank_access(94201),
    'admin role is not itself a premium content entitlement'
);

SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000004',true);
SELECT extensions.ok(
    (public.resolve_my_access('pathway',94101,NULL)->>'has_access')::boolean
    AND public.resolve_my_access('pathway',94101,NULL)->>'coverage_kind'='broader'
    AND public.resolve_my_access('pathway',94101,NULL)->>'coverage_source'='all_banks',
    'active grants for every current bank activate the pathway through aggregate coverage'
);

RESET ROLE;
UPDATE public.user_access_grants
SET revoked_at=now(),
    revoked_by='41000000-0000-0000-0000-000000000003',
    revoke_reason='remove one bank subscription'
WHERE user_id='41000000-0000-0000-0000-000000000004'
  AND scope_type='bank'
  AND question_bank_id=94202;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000004',true);
SELECT extensions.ok(
    NOT (public.resolve_my_access('pathway',94101,NULL)->>'has_access')::boolean,
    'revoking one bank removes aggregate pathway activation'
);

RESET ROLE;
UPDATE public.question_banks
SET is_free_trial=TRUE,
    free_trial_block_limit=1,
    free_trial_question_limit=70,
    free_trial_article_limit=10
WHERE id=94201;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','41000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    public.can_access_question_bank(94201),
    'free trial remains a separate demo path after premium revoke'
);

SELECT extensions.ok(
    NOT public.has_premium_question_bank_access(94201),
    'free trial availability does not turn into premium entitlement'
);

SELECT * FROM extensions.finish();
ROLLBACK;
