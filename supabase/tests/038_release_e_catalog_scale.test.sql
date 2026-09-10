BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(42);

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

-- Test-only fixture lookup. The enclosing transaction is rolled back, so the
-- production contract (catalog tables are private/RPC-only with RLS) is unchanged.
ALTER TABLE public.catalog_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_plans DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.catalog_products, public.catalog_plans TO authenticated;

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
        NULL,
        (SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821),
        '6 Months',6,1000,'EGP','active',TRUE,TRUE,TRUE,10
    )->>'status'),
    'active',
    'admin can create a published catalog plan'
);

SELECT extensions.is(
    (public.admin_save_catalog_plan(
        NULL,
        (SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821),
        '3 Months',3,500,'EGP','active',TRUE,FALSE,FALSE,20
    )->>'status'),
    'active',
    'admin can create a second catalog duration'
);

SELECT extensions.is(
    (public.admin_save_catalog_product(
        (SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821),
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
    EXISTS (
        SELECT 1 FROM public.admin_audit_logs
        WHERE action IN ('catalog_plan_saved','catalog_product_saved','catalog_bank_trial_saved')
          AND actor_user_id = '38000000-0000-0000-0000-000000000006'
    ),
    'catalog admin changes are audited'
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

SELECT extensions.ok(
    jsonb_array_length(public.get_catalog_upgrade_offer('bank',9821)->'plans') >= 2,
    'upgrade offer returns available catalog durations'
);

SELECT extensions.is(
    (public.preview_catalog_quote(
        (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='6 Months'),
        'RELEASEE10'
    )->>'final_price')::NUMERIC,
    900::NUMERIC,
    'promo preview computes the published final price'
);

SELECT extensions.is(
    public.preview_catalog_quote(
        (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='6 Months'),
        'RELEASEE10'
    )->>'promo_applied',
    'true',
    'promo preview reports that the promo was applied'
);

SELECT extensions.is(
    public.create_catalog_upgrade_request(
        (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='6 Months'),
        'RELEASEE10',NULL
    )->>'status',
    'pending',
    'student can create a catalog upgrade request'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.orders WHERE user_id='38000000-0000-0000-0000-000000000001'),
    0,
    'creating a catalog request does not automatically create an order'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.payments payment JOIN public.orders order_row ON order_row.id=payment.order_id WHERE order_row.user_id='38000000-0000-0000-0000-000000000001'),
    0,
    'creating a catalog request does not automatically record payment'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000001'),
    0,
    'creating a catalog request does not automatically grant premium access'
);

SELECT extensions.is(
    public.create_catalog_upgrade_request(
        (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='6 Months'),
        'RELEASEE10',NULL
    )->>'existing',
    'true',
    'repeating the same open catalog request is idempotent'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000005',true);

SELECT extensions.throws_ok(
    format(
        'SELECT public.support_save_upgrade_order(%L,6,1000,0,1000,%L,NULL)',
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000001' AND status='pending' ORDER BY created_at DESC LIMIT 1),
        'EGP'
    ),
    'CATALOG_ORDER_MUST_MATCH_QUOTE',
    'Support cannot overwrite a published customer quote'
);

SELECT extensions.is(
    public.support_save_upgrade_order(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000001' AND status='pending' ORDER BY created_at DESC LIMIT 1),
        6,1000,100,900,'EGP','Manual Support sale from catalog quote'
    )->>'status',
    'awaiting_payment',
    'Support can create the order when it exactly matches the catalog quote'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.payments payment JOIN public.orders order_row ON order_row.id=payment.order_id WHERE order_row.user_id='38000000-0000-0000-0000-000000000001'),
    0,
    'saving the order still does not automatically create a payment'
);

SELECT extensions.is(
    public.support_record_upgrade_payment(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000001' AND status='contacted' ORDER BY created_at DESC LIMIT 1),
        900,'EGP','InstaPay','RELEASE-E-MANUAL-1','Verified manually by Support'
    )->>'paid_enough',
    'true',
    'Support manually records the confirmed payment'
);

SELECT extensions.is(
    (SELECT status FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000001' ORDER BY created_at DESC LIMIT 1),
    'paid',
    'request becomes paid only after the manual payment record'
);

SELECT extensions.is(
    public.support_activate_upgrade(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000001' AND status='paid' ORDER BY created_at DESC LIMIT 1)
    )->>'status',
    'activated',
    'Support manually activates access after payment is confirmed'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000001' AND question_bank_id=9821 AND revoked_at IS NULL),
    1,
    'manual activation creates exactly one authoritative access grant'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);
SELECT extensions.is(
    public.resolve_my_access('bank',NULL,9821)->>'coverage_kind',
    'exact',
    'unified access resolver recognizes the authoritative grant'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SELECT public.create_catalog_upgrade_request(
    (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='6 Months'),
    NULL,NULL
);

SELECT extensions.is(
    public.create_catalog_upgrade_request(
        (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='3 Months'),
        NULL,
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000002' AND status='pending' ORDER BY created_at DESC LIMIT 1)
    )->>'status',
    'pending',
    'student can replace an unpaid pending request with another duration'
);

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

SELECT extensions.is(
    public.cancel_my_catalog_upgrade_request(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000002' AND status='pending' ORDER BY created_at DESC LIMIT 1)
    )->>'status',
    'cancelled',
    'student can cancel their own unpaid catalog request'
);

RESET ROLE;

INSERT INTO public.user_access_grants (
    user_id,scope_type,question_bank_id,starts_at,expires_at,granted_by
) VALUES (
    '38000000-0000-0000-0000-000000000003','bank',9821,now()-interval '1 day',now()+interval '30 days','38000000-0000-0000-0000-000000000006'
);

INSERT INTO public.user_access_grants (
    user_id,scope_type,pathway_id,starts_at,expires_at,granted_by
) VALUES (
    '38000000-0000-0000-0000-000000000004','pathway',9810,now()-interval '1 day',now()+interval '6 months','38000000-0000-0000-0000-000000000006'
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
        public.create_catalog_upgrade_request(
            (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='3 Months'),
            NULL,NULL
        )->>'request_id',''
    ) IS NOT NULL,
    'student can create an extension request'
);

SELECT extensions.is(
    (SELECT quote_snapshot->>'extension_grant_id' FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000003' AND status='pending' ORDER BY created_at DESC LIMIT 1),
    (SELECT id::TEXT FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000003' AND question_bank_id=9821 LIMIT 1),
    'extension request pins the exact access grant it will extend'
);

SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000005',true);

SELECT extensions.is(
    public.support_save_upgrade_order(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000003' AND status='pending' ORDER BY created_at DESC LIMIT 1),
        3,500,0,500,'EGP','Manual extension sale'
    )->>'status',
    'awaiting_payment',
    'Support creates the extension order manually'
);

SELECT extensions.is(
    public.support_record_upgrade_payment(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000003' AND status='contacted' ORDER BY created_at DESC LIMIT 1),
        500,'EGP','InstaPay','RELEASE-E-MANUAL-2','Verified manually by Support'
    )->>'paid_enough',
    'true',
    'extension payment is also recorded manually'
);

SELECT extensions.is(
    public.support_activate_upgrade(
        (SELECT id FROM public.upgrade_requests WHERE user_id='38000000-0000-0000-0000-000000000003' AND status='paid' ORDER BY created_at DESC LIMIT 1)
    )->>'extension',
    'true',
    'Support manually activates the extension path'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000003' AND question_bank_id=9821),
    1,
    'extension updates the existing grant instead of creating a duplicate grant'
);

SELECT extensions.ok(
    (SELECT expires_at > now() + interval '100 days' FROM public.user_access_grants WHERE user_id='38000000-0000-0000-0000-000000000003' AND question_bank_id=9821 LIMIT 1),
    'extension advances the expiry on the authoritative grant'
);

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
        (SELECT id FROM public.catalog_plans WHERE product_id=(SELECT id FROM public.catalog_products WHERE product_type='bank' AND question_bank_id=9821) AND name='3 Months')
    ),
    'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT',
    'database also blocks a redundant narrow request under broader access'
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

SELECT * FROM extensions.finish();
ROLLBACK;
