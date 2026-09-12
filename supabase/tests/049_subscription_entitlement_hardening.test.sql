BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(32);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000001','authenticated','authenticated','coverage-buyer@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000002','authenticated','authenticated','coverage-payment@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000003','authenticated','authenticated','coverage-support@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','49000000-0000-0000-0000-000000000004','authenticated','authenticated','coverage-admin@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

UPDATE public.profiles SET role='support' WHERE id='49000000-0000-0000-0000-000000000003';
UPDATE public.profiles SET role='admin' WHERE id='49000000-0000-0000-0000-000000000004';

INSERT INTO public.pathways (id,name,slug,display_order) VALUES
(9490,'Coverage Pathway A','coverage-pathway-a',9490),
(9493,'Coverage Pathway B','coverage-pathway-b',9493);

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit,display_order
) VALUES
(9491,9490,'Coverage Bank A1',FALSE,NULL,70,10,9491),
(9492,9490,'Coverage Bank A2',FALSE,NULL,70,10,9492),
(9494,9493,'Coverage Bank B1',FALSE,NULL,70,10,9494);

SELECT set_config('royal_test.product_a1',(SELECT id::text FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9491),true);
SELECT set_config('royal_test.product_a2',(SELECT id::text FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9492),true);
SELECT set_config('royal_test.product_b1',(SELECT id::text FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9494),true);
SELECT set_config('royal_test.product_path_a',(SELECT id::text FROM public.catalog_products WHERE product_type='pathway' AND pathway_id=9490),true);
SELECT set_config('royal_test.product_global',(SELECT id::text FROM public.catalog_products WHERE product_type='global' ORDER BY id LIMIT 1),true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000004',true);

SELECT public.admin_save_catalog_plan(NULL,current_setting('royal_test.product_a1')::BIGINT,'1 Month',1,100,'EGP','active',TRUE,TRUE,TRUE,10);
SELECT public.admin_save_catalog_plan(NULL,current_setting('royal_test.product_a2')::BIGINT,'1 Month',1,100,'EGP','active',TRUE,TRUE,TRUE,10);
SELECT public.admin_save_catalog_plan(NULL,current_setting('royal_test.product_b1')::BIGINT,'1 Month',1,100,'EGP','active',TRUE,TRUE,TRUE,10);
SELECT public.admin_save_catalog_plan(NULL,current_setting('royal_test.product_path_a')::BIGINT,'Full Pathway',6,500,'EGP','active',TRUE,TRUE,TRUE,10);
SELECT public.admin_save_catalog_plan(NULL,current_setting('royal_test.product_global')::BIGINT,'All Royal',12,1000,'EGP','active',TRUE,TRUE,TRUE,10);

SELECT public.admin_save_catalog_product(current_setting('royal_test.product_a1')::BIGINT,'active',10,TRUE,'Coverage bank A1');
SELECT public.admin_save_catalog_product(current_setting('royal_test.product_a2')::BIGINT,'active',20,TRUE,'Coverage bank A2');
SELECT public.admin_save_catalog_product(current_setting('royal_test.product_b1')::BIGINT,'active',30,TRUE,'Coverage bank B1');
SELECT public.admin_save_catalog_product(current_setting('royal_test.product_path_a')::BIGINT,'active',40,TRUE,'Coverage pathway A');
SELECT public.admin_save_catalog_product(current_setting('royal_test.product_global')::BIGINT,'active',50,TRUE,'All Royal');

RESET ROLE;
SELECT set_config('royal_test.plan_a1',(SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_a1')::BIGINT AND name='1 Month'),true);
SELECT set_config('royal_test.plan_a2',(SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_a2')::BIGINT AND name='1 Month'),true);
SELECT set_config('royal_test.plan_b1',(SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_b1')::BIGINT AND name='1 Month'),true);
SELECT set_config('royal_test.plan_path_a',(SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_path_a')::BIGINT AND name='Full Pathway'),true);
SELECT set_config('royal_test.plan_global',(SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_global')::BIGINT AND name='All Royal'),true);

INSERT INTO public.user_access_grants(
    user_id,scope_type,question_bank_id,starts_at,expires_at,granted_by
) VALUES (
    '49000000-0000-0000-0000-000000000001','bank',9491,
    now()-interval '1 day',now()+interval '30 days','49000000-0000-0000-0000-000000000004'
);

SELECT extensions.is(
    has_function_privilege('authenticated','public.grant_user_access(uuid,text,bigint,bigint,timestamptz,timestamptz)','EXECUTE'),
    FALSE,
    'authenticated callers still cannot invoke the raw grant primitive'
);
SELECT extensions.ok(to_regclass('public.upgrade_requests_one_open_user_uidx') IS NULL,'user-global open-request lock is removed for multi-product subscriptions');
SELECT extensions.ok(to_regclass('public.upgrade_requests_open_catalog_product_uidx') IS NOT NULL,'same-product open requests remain uniquely protected');
SELECT extensions.ok(to_regclass('public.payments_transaction_reference_uidx') IS NOT NULL,'payment transaction references remain uniquely protected');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(public.can_access_question_bank(9491),'first purchased bank remains accessible');
SELECT extensions.ok(NOT public.can_access_question_bank(9492),'unsubscribed sibling bank starts locked');
SELECT extensions.is(public.resolve_my_access('pathway',9490,NULL)->>'has_access','false','partial bank ownership does not yet activate the pathway');
SELECT extensions.is(public.get_catalog_upgrade_offer('bank',9491)->>'mode','extension','finite exact bank access can be extended');
SELECT extensions.is(public.get_catalog_upgrade_offer('bank',9492)->>'mode','upgrade','a different bank remains purchasable');
SELECT extensions.is(public.get_catalog_upgrade_offer('bank',9492)->>'can_request','true','a different bank can be requested while bank A1 is active');

SELECT set_config('royal_test.req_a2',public.create_catalog_upgrade_request(current_setting('royal_test.plan_a2')::BIGINT,NULL,NULL)->>'request_id',true);
SELECT extensions.is(public.create_catalog_upgrade_request(current_setting('royal_test.plan_a2')::BIGINT,NULL,NULL)->>'status','pending','second bank request is accepted while another bank subscription is active');
SELECT extensions.is(public.create_catalog_upgrade_request(current_setting('royal_test.plan_a2')::BIGINT,NULL,NULL)->>'existing','true','repeating the same bank request is idempotent');

SELECT set_config('royal_test.req_path',public.create_catalog_upgrade_request(current_setting('royal_test.plan_path_a')::BIGINT,NULL,NULL)->>'request_id',true);
SELECT extensions.is(public.create_catalog_upgrade_request(current_setting('royal_test.plan_path_a')::BIGINT,NULL,NULL)->>'status','pending','full pathway remains purchasable while only part of its banks are owned');
SELECT extensions.ok(current_setting('royal_test.req_a2')::UUID <> current_setting('royal_test.req_path')::UUID,'independent catalog products maintain distinct open requests');
SELECT extensions.is(public.cancel_my_catalog_upgrade_request(current_setting('royal_test.req_path')::UUID)->>'status','cancelled','pathway request can be cancelled without touching the bank request');

SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000003',true);
SELECT extensions.is(
    public.support_save_upgrade_order(current_setting('royal_test.req_a2')::UUID,1,100,0,100,'EGP','second bank sale')->>'status',
    'awaiting_payment',
    'Support can create the paid-flow order for a second bank'
);
SELECT extensions.is(
    public.support_record_upgrade_payment(current_setting('royal_test.req_a2')::UUID,100,'EGP','InstaPay','COVERAGE-A2-001','second bank payment')->>'paid_enough',
    'true',
    'Support can confirm payment for a second bank while the first bank is active'
);
SELECT extensions.is(
    public.support_activate_upgrade(current_setting('royal_test.req_a2')::UUID)->>'status',
    'activated',
    'Support activation creates the second independent bank entitlement'
);

SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);
SELECT extensions.ok(public.can_access_question_bank(9492),'second bank becomes accessible after the real activation flow');
SELECT extensions.ok(
    (public.resolve_my_access('pathway',9490,NULL)->>'has_access')::BOOLEAN
    AND public.resolve_my_access('pathway',9490,NULL)->>'coverage_kind'='broader'
    AND public.resolve_my_access('pathway',9490,NULL)->>'coverage_source'='all_banks',
    'owning every current bank activates the pathway automatically'
);
SELECT extensions.is(public.get_catalog_upgrade_offer('pathway',9490)->>'mode','active','fully covered pathway cannot be redundantly repurchased');

SELECT set_config('royal_test.req_global',public.create_catalog_upgrade_request(current_setting('royal_test.plan_global')::BIGINT,NULL,NULL)->>'request_id',true);
SELECT extensions.is(public.create_catalog_upgrade_request(current_setting('royal_test.plan_global')::BIGINT,NULL,NULL)->>'status','pending','All Royal remains purchasable above existing narrower bank access');
SELECT extensions.is(public.cancel_my_catalog_upgrade_request(current_setting('royal_test.req_global')::UUID)->>'status','cancelled','All Royal request can be cancelled normally');

SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000004',true);
SELECT extensions.throws_ok(
    $$SELECT public.admin_grant_user_access('49000000-0000-0000-0000-000000000001','bank',NULL,9492,now(),now()+interval '60 days')$$,
    'ACCESS_ALREADY_ACTIVE',
    'duplicate exact bank access is still rejected'
);

SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);
SELECT extensions.is(public.get_catalog_upgrade_offer('bank',9494)->>'mode','upgrade','bank in another pathway remains independently purchasable');

SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000004',true);
SELECT extensions.is(
    (public.admin_grant_user_access('49000000-0000-0000-0000-000000000001','bank',NULL,9494,now(),now()+interval '45 days')->>'question_bank_id')::BIGINT,
    9494::BIGINT,
    'bank in another pathway can coexist with existing bank grants'
);

SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000001',true);
SELECT extensions.ok(public.can_access_question_bank(9494),'cross-pathway bank grant is effective');

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
    public.support_record_upgrade_payment('49900000-0000-0000-0000-000000000001',100,'EGP','InstaPay','COVERAGE-REF-001','first confirmation')->>'idempotent',
    'false',
    'first payment reference creates a confirmed payment'
);
SELECT extensions.is(
    public.support_record_upgrade_payment('49900000-0000-0000-0000-000000000001',100,'EGP','InstaPay','coverage-ref-001','safe retry')->>'idempotent',
    'true',
    'retrying the exact payment reference remains idempotent and case-insensitive'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::TEXT FROM public.payments WHERE order_id='49910000-0000-0000-0000-000000000001'),
    '1',
    'payment retry does not create a duplicate row'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','49000000-0000-0000-0000-000000000003',true);
SELECT extensions.throws_ok(
    $$SELECT public.support_record_upgrade_payment('49900000-0000-0000-0000-000000000001',99,'EGP','InstaPay','COVERAGE-REF-001','conflicting retry')$$,
    'PAYMENT_REFERENCE_ALREADY_USED',
    'conflicting reuse of a payment reference is still rejected'
);
SELECT extensions.throws_ok(
    $$SELECT public.support_record_upgrade_payment('49900000-0000-0000-0000-000000000001',1,'EGP','InstaPay',NULL,'missing reference')$$,
    'INVALID_PAYMENT_VALUES',
    'new support payments still require a transaction reference'
);

SELECT * FROM extensions.finish();
ROLLBACK;
