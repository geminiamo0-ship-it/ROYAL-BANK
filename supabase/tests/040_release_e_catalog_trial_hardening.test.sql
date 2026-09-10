BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '48000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','releasee-trial-admin@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles
SET role = 'admin'
WHERE id = '48000000-0000-0000-0000-000000000001';

INSERT INTO public.pathways (id,name,slug,display_order)
VALUES (9910,'Release E Trial Hardening Pathway','release-e-trial-hardening',9910);

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit,display_order
) VALUES (
    9921,9910,'Release E Trial Hardening Bank',FALSE,NULL,70,10,9921
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','48000000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    (public.admin_update_catalog_bank_trial(9921,TRUE,2,70,10)->>'bank_id')::BIGINT,
    9921::BIGINT,
    'admin can enable the bank free trial'
);

RESET ROLE;

SELECT extensions.is(
    (SELECT is_free_trial FROM public.question_banks WHERE id=9921),
    TRUE,
    'enabling trial persists the enabled state'
);
SELECT extensions.is(
    (SELECT free_trial_block_limit FROM public.question_banks WHERE id=9921),
    2,
    'enabling trial persists the configured block limit'
);
SELECT extensions.is(
    (SELECT is_free_trial_available FROM public.pathways WHERE id=9910),
    TRUE,
    'enabling a bank trial marks its pathway as trial available'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','48000000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    (public.admin_update_catalog_bank_trial(9921,FALSE,0,70,10)->>'bank_id')::BIGINT,
    9921::BIGINT,
    'admin can disable the bank free trial even when the form posts block limit zero'
);

RESET ROLE;

SELECT extensions.ok(
    (SELECT NOT is_free_trial AND free_trial_block_limit IS NULL FROM public.question_banks WHERE id=9921),
    'disabling trial stores the canonical false plus NULL block-limit shape'
);
SELECT extensions.is(
    (SELECT is_free_trial_available FROM public.pathways WHERE id=9910),
    FALSE,
    'disabling the last bank trial clears pathway trial availability'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','48000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT public.admin_update_catalog_bank_trial(9921,TRUE,2,0,10)$$,
    'INVALID_TRIAL_CONFIGURATION',
    'invalid question limits fail at the catalog boundary instead of a raw table constraint'
);

RESET ROLE;
SELECT extensions.is(
    has_function_privilege(
        'anon',
        'public.admin_update_catalog_bank_trial(bigint,boolean,integer,integer,integer)',
        'EXECUTE'
    ),
    FALSE,
    'anon remains unable to mutate trial configuration'
);

SELECT * FROM extensions.finish();
ROLLBACK;
