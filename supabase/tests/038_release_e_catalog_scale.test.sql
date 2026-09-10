BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(47);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
('00000000-0000-0000-0000-000000000000','38000000-0000-0000-0000-000000000001','authenticated','authenticated','releasee-buyer@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','38000000-0000-0000-0000-000000000002','authenticated','authenticated','releasee-replace@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','38000000-0000-0000-0000-000000000003','authenticated','authenticated','releasee-extend@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','38000000-0000-0000-0000-000000000004','authenticated','authenticated','releasee-broader@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','38000000-0000-0000-0000-000000000005','authenticated','authenticated','releasee-support@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','38000000-0000-0000-0000-000000000006','authenticated','authenticated','releasee-admin@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

UPDATE public.profiles SET role = 'support' WHERE id = '38000000-0000-0000-0000-000000000005';
UPDATE public.profiles SET role = 'admin' WHERE id = '38000000-0000-0000-0000-000000000006';

INSERT INTO public.pathways (id,name,slug,display_order)
VALUES (9810,'Release E Test Pathway','release-e-test-pathway',9810);

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit,display_order
) VALUES (9821,9810,'Release E Test Bank',FALSE,NULL,70,10,9821);

SELECT set_config(
    'royal_test.product_id',
    (SELECT id::text FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821),
    true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT public.admin_list_catalog()$$,
    'ADMIN_ACCESS_REQUIRED',
    'ordinary students cannot read admin catalog management'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000006',true);

SELECT extensions.is(
    (public.admin_save_catalog_plan(
        NULL,current_setting('royal_test.product_id')::BIGINT,
        '6 Months',6,1000,'EGP','active',TRUE,TRUE,TRUE,10
    )->>'status'),
    'active',
    'admin can create a published six month catalog plan'
);

SELECT extensions.is(
    (public.admin_save_catalog_plan(
        NULL,current_setting('royal_test.product_id')::BIGINT,
        '3 Months',3,500,'EGP','active',TRUE,FALSE,FALSE,20
    )->>'status'),
    'active',
    'admin can create a second active catalog duration'
);

RESET ROLE;
SELECT set_config(
    'royal_test.plan6',
    (SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_id')::BIGINT AND name='6 Months'),
    true
);
SELECT set_config(
    'royal_test.plan3',
    (SELECT id::text FROM public.catalog_plans WHERE product_id=current_setting('royal_test.product_id')::BIGINT AND name='3 Months'),
    true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000006',true);

SELECT extensions.is(
    (public.admin_save_catalog_product(
        current_setting('royal_test.product_id')::BIGINT,
        'active',10,TRUE,'Release E premium bank access.'
    )->>'status'),
    'active',
    'admin can activate the catalog product after plans exist'
);

SELECT extensions.is(
    (public.admin_update_catalog_bank_trial(9821,TRUE,2,70,10)->>'bank_id')::BIGINT,
    9821::BIGINT,
    'admin can configure bank free-trial limits'
);

SELECT extensions.ok(
    jsonb_array_length(public.admin_list_catalog()->'audit') >= 3,
    'catalog admin changes are visible in the audited admin catalog API'
);

RESET ROLE;
INSERT INTO public.promo_codes (
    code,discount_type,discount_value,commission_type,commission_basis,created_by
) VALUES ('RELEASEE10','percentage',10,'none','amount_paid','38000000-0000-0000-0000-000000000006');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'mode',
    'upgrade',
    'student without premium access sees upgrade mode'
);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'can_request',
    'true',
    'student without premium access can request an upgrade'
);

SELECT extensions.ok(
    jsonb_array_length(public.get_catalog_upgrade_offer('bank',9821)->'plans') >= 2,
    'upgrade offer returns the active catalog durations'
);

SELECT extensions.is(
    (public.preview_catalog_quote(current_setting('royal_test.plan6')::BIGINT,'RELEASEE10')->>'final_price')::NUMERIC,
    900::NUMERIC,
    'promo preview computes the published final price'
);

SELECT extensions.is(
    public.preview_catalog_quote(current_setting('royal_test.plan6')::BIGINT,'RELEASEE10')->>'promo_applied',
    'true',
    'promo preview reports that the promo was applied'
);

SELECT extensions.is(
    public.create_catalog_upgrade_request(current_setting('royal_test.plan6')::BIGINT,'RELEASEE10',NULL)->>'status',
    'pending',
    'student can create a catalog upgrade request'
);

SELECT extensions.is(
    public.create_catalog_upgrade_request(current_setting('royal_test.plan6')::BIGINT,'RELEASEE10',NULL)->>'existing',
    'true',
    'repeating the same open catalog request is idempotent'
);

SELECT set_config(
    'royal_test.req1',
    public.create_catalog_upgrade_request(current_setting('royal_test.plan6')::BIGINT,'RELEASEE10',NULL)->>'request_id',
    true
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.orders WHERE upgrade_request_id=current_setting('royal_test.req1')::UUID),
    0,
    'creating a catalog request does not automatically create an order'
);
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.payments p JOIN public.orders o ON o.id=p.order_id WHERE o.upgrade_request_id=current_setting('royal_test.req1')::UUID),
    0,
    'creating a catalog request does not automatically record payment'
);
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000001'),
    0,
    'creating a catalog request does not automatically grant premium access'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000005',true);

SELECT extensions.throws_ok(
    format(
        'SELECT public.support_save_upgrade_order(%L,6,1000,0,1000,%L,NULL)',
        current_setting('royal_test.req1'),'EGP'
    ),
    'CATALOG_ORDER_MUST_MATCH_QUOTE',
    'Support cannot overwrite a published customer quote'
);

SELECT extensions.is(
    public.support_save_upgrade_order(
        current_setting('royal_test.req1')::UUID,
        6,1000,100,900,'EGP','Manual Support sale from catalog quote'
    )->>'status',
    'awaiting_payment',
    'Support can create the order when it exactly matches the catalog quote'
);

SELECT extensions.is(
    public.support_get_upgrade_request(current_setting('royal_test.req1')::UUID)->'request'->>'status',
    'contacted',
    'saving the manual order moves the request to contacted'
);

SELECT extensions.is(
    public.support_record_upgrade_payment(
        current_setting('royal_test.req1')::UUID,
        900,'EGP','InstaPay','RELEASE-E-MANUAL-1','Verified manually by Support'
    )->>'paid_enough',
    'true',
    'Support manually records the confirmed payment'
);

SELECT extensions.is(
    public.support_get_upgrade_request(current_setting('royal_test.req1')::UUID)->'request'->>'status',
    'paid',
    'request becomes paid only after the manual payment record'
);

SELECT extensions.is(
    public.support_activate_upgrade(current_setting('royal_test.req1')::UUID)->>'status',
    'activated',
    'Support manually activates access after payment is confirmed'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000001' AND question_bank_id=9821 AND revoked_at IS NULL),
    1,
    'manual activation creates exactly one authoritative access grant'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    public.resolve_my_access('bank',NULL,9821)->>'coverage_kind',
    'exact',
    'unified access resolver recognizes the authoritative bank grant'
);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'mode',
    'extension',
    'an already subscribed finite user no longer sees a stale upgrade mode'
);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'can_request',
    'true',
    'finite exact access permits extension rather than redundant upgrade'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SELECT set_config(
    'royal_test.req2',
    public.create_catalog_upgrade_request(current_setting('royal_test.plan6')::BIGINT,NULL,NULL)->>'request_id',
    true
);

SELECT extensions.is(
    public.create_catalog_upgrade_request(
        current_setting('royal_test.plan3')::BIGINT,
        NULL,current_setting('royal_test.req2')::UUID
    )->>'status',
    'pending',
    'student can replace an unpaid pending request with another duration'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000002' AND status='cancelled'),
    1,
    'replaced request is cancelled with history preserved'
);
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000002' AND status IN ('pending','contacted','paid')),
    1,
    'only one open catalog request remains after replacement'
);
SELECT set_config(
    'royal_test.req2_open',
    (SELECT id::text FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000002' AND status='pending' ORDER BY created_at DESC LIMIT 1),
    true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SELECT extensions.is(
    public.cancel_my_catalog_upgrade_request(current_setting('royal_test.req2_open')::UUID)->>'status',
    'cancelled',
    'student can cancel their own unpaid catalog request'
);

RESET ROLE;
INSERT INTO public.user_access_grants (
    user_id,scope_type,question_bank_id,starts_at,expires_at,granted_by
) VALUES (
    '38000000-0000-0000-0000-000000000003','bank',9821,now()-interval '1 day',now()+interval '30 days','38000000-0000-0000-0000-000000000006'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000003',true);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'mode',
    'extension',
    'exact finite access exposes extension mode'
);

SELECT extensions.ok(
    NULLIF(
        public.create_catalog_upgrade_request(current_setting('royal_test.plan3')::BIGINT,NULL,NULL)->>'request_id',''
    ) IS NOT NULL,
    'student can create an extension request'
);

SELECT set_config(
    'royal_test.req3',
    public.create_catalog_upgrade_request(current_setting('royal_test.plan3')::BIGINT,NULL,NULL)->>'request_id',
    true
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000005',true);
SELECT public.support_save_upgrade_order(
    current_setting('royal_test.req3')::UUID,
    3,500,0,500,'EGP','Manual extension sale'
);
SELECT public.support_record_upgrade_payment(
    current_setting('royal_test.req3')::UUID,
    500,'EGP','InstaPay','RELEASE-E-MANUAL-2','Verified manually by Support'
);

SELECT extensions.is(
    public.support_activate_upgrade(current_setting('royal_test.req3')::UUID)->>'extension',
    'true',
    'Support manually activates the extension path'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000003' AND question_bank_id=9821),
    1,
    'extension updates the existing grant instead of creating a duplicate grant'
);
SELECT extensions.ok(
    (SELECT expires_at > now() + interval '100 days' FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000003' AND question_bank_id=9821 LIMIT 1),
    'extension advances the expiry on the authoritative grant'
);

INSERT INTO public.user_access_grants (
    user_id,scope_type,pathway_id,starts_at,expires_at,granted_by
) VALUES (
    '38000000-0000-0000-0000-000000000004','pathway',9810,now()-interval '1 day',now()+interval '6 months','38000000-0000-0000-0000-000000000006'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000004',true);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'mode',
    'active',
    'broader pathway access marks the bank product active without redundant upgrade'
);

SELECT extensions.is(
    public.get_catalog_upgrade_offer('bank',9821)->>'can_request',
    'false',
    'broader access disables redundant narrow requests'
);

SELECT extensions.throws_ok(
    format(
        'SELECT public.create_catalog_upgrade_request(%s,NULL,NULL)',
        current_setting('royal_test.plan3')
    ),
    'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT',
    'database blocks a redundant narrow request under broader access'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SELECT extensions.is(
    public.get_catalog_upgrade_offer('global',NULL)->'product'->>'product_type',
    'global',
    'All Royal is a first-class global catalog product'
);

RESET ROLE;
SELECT extensions.is(
    has_function_privilege('anon','public.resolve_my_access(text,bigint,bigint)','EXECUTE'),
    FALSE,
    'anon cannot execute the unified access resolver'
);
SELECT extensions.is(
    has_function_privilege('anon','public.get_catalog_upgrade_offer(text,bigint)','EXECUTE'),
    FALSE,
    'anon cannot execute catalog upgrade offers'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000006',true);
SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM jsonb_array_elements(public.admin_list_catalog()->'products') product
        WHERE product->>'name' = 'Release E Test Bank'
    ),
    'admin catalog API includes the managed test product'
);

SELECT public.admin_save_catalog_product(
    current_setting('royal_test.product_id')::BIGINT,
    'active',10,FALSE,'Release E premium bank access.'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SELECT extensions.is(
    public.preview_catalog_quote(current_setting('royal_test.plan6')::BIGINT,NULL)->>'price_visible',
    'false',
    'public price toggle hides the selected plan price'
);
SELECT extensions.is(
    public.preview_catalog_quote(current_setting('royal_test.plan6')::BIGINT,NULL)->>'base_price',
    NULL,
    'hidden public pricing suppresses the numeric base price'
);
SELECT extensions.ok(
    jsonb_array_length(public.get_catalog_upgrade_offer('bank',9821)->'plans') >= 2,
    'upgrade flow still exposes duration choices when public prices are hidden'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000006',true);
SELECT public.admin_save_catalog_plan(
    current_setting('royal_test.plan3')::BIGINT,
    current_setting('royal_test.product_id')::BIGINT,
    '3 Months',3,500,'EGP','inactive',TRUE,FALSE,FALSE,20
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SELECT extensions.is(
    (
        SELECT count(*)::TEXT
        FROM jsonb_array_elements(public.get_catalog_upgrade_offer('bank',9821)->'plans') plan
        WHERE plan->>'name' = '3 Months'
    ),
    '0',
    'inactive catalog durations are omitted from the user-facing dropdown'
);
SELECT extensions.is(
    (
        SELECT count(*)::TEXT
        FROM jsonb_array_elements(public.get_catalog_upgrade_offer('bank',9821)->'plans') plan
        WHERE plan->>'name' = '6 Months'
    ),
    '1',
    'active catalog durations remain available after another duration is disabled'
);

SELECT * FROM extensions.finish();
ROLLBACK;
