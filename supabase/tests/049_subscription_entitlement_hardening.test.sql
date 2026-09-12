BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000001','authenticated','authenticated','sub-hardening-a@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000002','authenticated','authenticated','sub-hardening-b@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000003','authenticated','authenticated','sub-hardening-support@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000004','authenticated','authenticated','sub-hardening-admin@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

UPDATE public.profiles SET role='support' WHERE id='49000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET role='admin' WHERE id='49000000-0000-0000-0000-000000000004';

INSERT INTO public.pathways (id,name,slug,display_order)
VALUES (9490,'Subscription Hardening Pathway','subscription-hardening-pathway',9490);

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit,display_order
) VALUES
(9491,9490,'Subscription Hardening Bank A',FALSE,NULL,70,10,9491),
(9492,9490,'Subscription Hardening Bank B',FALSE,NULL,70,10,9492);

SELECT set_config(
    'royal_test.product_a',
    (SELECT id::text FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9491),
    true
);
SELECT set_config(
    'royal_test.product_b',
    (SELECT id::text FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9492),
    true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000004',true);

SELECT public.admin_save_catalog_plan(
    NULL,current_setting('royal_test.product_a')::BIGINT,
    '1 Month',1,100,'EGP','active',TRUE,TRUE,TRUE,10
);
SELECT public.admin_save_catalog_plan(
    NULL,current_setting('royal_test.product_b')::BIGINT,
    '1 Month',1,100,'EGP','active',TRUE,TRUE,TRUE,10
);
SELECT public.admin_save_catalog_product(
    current_setting('royal_test.product_a')::BIGINT,
    'active',10,TRUE,'Hardening bank A.'
);
SELECT public.admin_save_catalog_product(
    current_setting('royal_test.product_b')::BIGINT,
    'active',20,TRUE,'Hardening bank B.'
);

RESET ROLE;
SELECT set_config(
    'royal_test.plan_a',
    (SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_a')::BIGINT AND name='1 Month'),
    true
);
SELECT set_config(
    'royal_test.plan_b',
    (SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_b')::BIGINT AND name='1 Month'),
    true
);

INSERT INTO public.user_access_grants (
    user_id,scope_type,question_bank_id,starts_at,expires_at,granted_by
) VALUES (
    '49000000-0000-0000-0000-000000000001','bank',9491,
    now()-interval '1 day',now()+interval '30 days','49000000-0000-0000-0000-000000000004'
);

SELECT extensions.is(
    has_function_privilege(
        'authenticated',
        'public.grant_user_access(uuid,text,bigint,bigint,timestamptz,timestamptz)',
        'EXECUTE'
    ),
    FALSE,
    'authenticated callers cannot invoke the raw grant primitive'
);

SELECT extensions.ok(
    to_regclass('public.upgrade_requests_one_open_user_uidx') IS NOT NULL,
    'database has a user-global one-open-request unique index'
);

SELECT extensions.ok(
    to_regclass('public.payments_transaction_reference_uidx') IS NOT NULL,
    'database has a normalized payment-reference unique index'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    public.can_access_question_bank(9491),
    'the purchased bank remains accessible'
);
SELECT extensions.ok(
    NOT public.can_access_question_bank(9492),
    'a bank subscription does not unlock a sibling bank'
);
SELECT extensions.is(
    public.resolve_my_access('pathway',9490,NULL)->>'has_access',
    'false',
    'one bank grant no longer masquerades as pathway ownership'
);
SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9491)->>'mode',
    'extension',
    'the exact finite subscription can still be extended'
);
SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9492)->>'can_request',
    'false',
    'another bank cannot be purchased while a subscription is live'
);
SELECT extensions.throws_ok(
    format(
        'SELECT public.create_catalog_upgrade_request(%s,NULL,NULL)',
        current_setting('royal_test.plan_b')
    ),
    'ACTIVE_SUBSCRIPTION_EXISTS',
    'database rejects a second product request while another subscription is live'
);
SELECT extensions.is(
    public.get_my_catalog_overview()->>'commerce_locked',
    'true',
    'catalog overview exposes the user-global commerce lock'
);

RESET ROLE;
SELECT extensions.throws_ok(
    $$INSERT INTO public.user_access_grants(
        user_id,scope_type,question_bank_id,starts_at,expires_at,granted_by
      ) VALUES (
        '49000000-0000-0000-0000-000000000001','bank',9492,
        now(),now()+interval '30 days','49000000-0000-0000-0000-000000000004'
      )$$,
    'ACTIVE_SUBSCRIPTION_EXISTS',
    'database trigger rejects a second live grant even outside the catalog flow'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000004',true);
SELECT extensions.throws_ok(
    $$SELECT public.admin_update_user_access(
        '49000000-0000-0000-0000-000000000002',NULL,'premium_full',NULL
      )$$,
    'SUBSCRIPTION_TIER_IS_DERIVED',
    'admin cannot manufacture entitlement by editing the legacy profile tier'
);

RESET ROLE;
INSERT INTO public.upgrade_requests(
    id,public_code,user_id,scope_type,question_bank_id,status
) VALUES (
    '49900000-0000-0000-0000-000000000001','RY-A1B2C3D4',
    '49000000-0000-0000-0000-000000000002','bank',9492,'contacted'
);
INSERT INTO public.orders(
    id,upgrade_request_id,user_id,scope_type,question_bank_id,duration_months,
    base_price,discount_amount,agreed_price,currency,status,created_by
) VALUES (
    '49910000-0000-0000-0000-000000000001',
    '49900000-0000-0000-0000-000000000001',
    '49000000-0000-0000-0000-000000000002','bank',9492,1,
    100,0,100,'EGP','awaiting_payment','49000000-0000-0000-0000-000000000003'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000003',true);

SELECT extensions.is(
    public.support_record_upgrade_payment(
        '49900000-0000-0000-0000-000000000001',
        100,'EGP','InstaPay','SUB-HARDENING-REF-001','first confirmation'
    )->>'idempotent',
    'false',
    'first payment reference creates a confirmed payment'
);
SELECT extensions.is(
    public.support_record_upgrade_payment(
        '49900000-0000-0000-0000-000000000001',
        100,'EGP','InstaPay','sub-hardening-ref-001','safe retry'
    )->>'idempotent',
    'true',
    'retrying the exact payment reference is idempotent and case-insensitive'
);
SELECT extensions.is(
    (SELECT count(*)::TEXT FROM public.payments WHERE order_id='49910000-0000-0000-0000-000000000001'),
    '1',
    'payment retry does not create a duplicate row'
);
SELECT extensions.throws_ok(
    $$SELECT public.support_record_upgrade_payment(
        '49900000-0000-0000-0000-000000000001',
        99,'EGP','InstaPay','SUB-HARDENING-REF-001','conflicting retry'
      )$$,
    'PAYMENT_REFERENCE_ALREADY_USED',
    'a reused payment reference with different details is rejected'
);
SELECT extensions.throws_ok(
    $$SELECT public.support_record_upgrade_payment(
        '49900000-0000-0000-0000-000000000001',
        1,'EGP','InstaPay',NULL,'missing reference'
      )$$,
    'INVALID_PAYMENT_VALUES',
    'new support payments require a transaction reference'
);

SELECT * FROM extensions.finish();
ROLLBACK;
