BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '29000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','self-access-one@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '29000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','self-access-two@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9910,'Self Access Pathway','self-access-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES (9920,9910,'Self Access Bank',FALSE,NULL,70,10);

INSERT INTO public.user_access_grants (
    user_id,scope_type,pathway_id,starts_at,expires_at
) VALUES (
    '29000000-0000-0000-0000-000000000001','pathway',9910,now() - interval '1 day',now() + interval '30 days'
);

INSERT INTO public.user_access_grants (
    user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    '29000000-0000-0000-0000-000000000002','bank',9920,now() - interval '1 day',now() + interval '30 days'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    (SELECT count(*) FROM public.get_my_active_access_grants()),
    1::BIGINT,
    'self access summary returns only the signed-in user grants'
);

SELECT extensions.is(
    (SELECT scope_type FROM public.get_my_active_access_grants() LIMIT 1),
    'pathway',
    'self access summary exposes the active grant scope'
);

SELECT extensions.is(
    (SELECT pathway_id FROM public.get_my_active_access_grants() LIMIT 1),
    9910::BIGINT,
    'self access summary exposes only the matching pathway identifier'
);

SELECT * FROM extensions.finish();
ROLLBACK;
