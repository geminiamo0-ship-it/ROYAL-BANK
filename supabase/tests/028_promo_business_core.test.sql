BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(18);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '28000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','buyer-one@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '28000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','buyer-two@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '28000000-0000-0000-0000-000000000003',
    'authenticated','authenticated','support-two@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '28000000-0000-0000-0000-000000000004',
    'authenticated','authenticated','partner-two@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '28000000-0000-0000-0000-000000000005',
    'authenticated','authenticated','owner-admin@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles
SET role = 'support'
WHERE id = '28000000-0000-0000-0000-000000000003';

UPDATE public.profiles
SET role = 'admin'
WHERE id = '28000000-0000-0000-0000-000000000005';

INSERT INTO public.pathways (id,name,slug)
VALUES (9810,'Promo Business Test Pathway','promo-business-test-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES (
    9821,9810,'Promo Business Test Bank',TRUE,2,70,10
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000005',true);

SELECT extensions.is(
    public.admin_save_promo_code(
        NULL,
        'STAR20',
        '28000000-0000-0000-0000-000000000004',
        'active',
        'percentage',
        10,
        NULL,
        'percentage',
        15,
        NULL,
        'amount_paid',
        NULL,
        NULL,
        NULL
    )->>'code',
    'STAR20',
    'admin can create a promo code and assign it to an ordinary user account'
);

SELECT extensions.is(
    (SELECT owner_email FROM public.admin_list_promo_codes() WHERE code = 'STAR20'),
    'partner-two@test.local',
    'admin promo list resolves the assigned coupon owner'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000004',true);

SELECT extensions.throws_ok(
    $$SELECT * FROM public.admin_list_promo_codes()$$,
    'ADMIN_ACCESS_REQUIRED',
    'promo owner cannot read admin promo or finance data'
);

SELECT extensions.is(
    (SELECT activated_users FROM public.partner_get_coupon_summary() WHERE code = 'STAR20'),
    0::BIGINT,
    'promo owner starts with zero successful activated users'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000001',true);
SELECT public.create_upgrade_request('bank',NULL,9821,'STAR20');

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000003',true);
SELECT public.support_save_upgrade_order(
    (SELECT request_id FROM public.support_list_upgrade_requests(NULL,'buyer-one@test.local',50,0) LIMIT 1),
    6,2000,200,1800,'EGP','First promo sale'
);
SELECT public.support_record_upgrade_payment(
    (SELECT request_id FROM public.support_list_upgrade_requests(NULL,'buyer-one@test.local',50,0) LIMIT 1),
    1800,'EGP','InstaPay','PROMO-FIRST',NULL
);
SELECT public.support_activate_upgrade(
    (SELECT request_id FROM public.support_list_upgrade_requests(NULL,'buyer-one@test.local',50,0) LIMIT 1)
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000004',true);

SELECT extensions.is(
    (SELECT activated_users FROM public.partner_get_coupon_summary() WHERE code = 'STAR20'),
    1::BIGINT,
    'promo owner sees only a successful activated-user count after paid activation'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000005',true);

SELECT extensions.is(
    (SELECT activated_users FROM public.admin_list_promo_codes() WHERE code = 'STAR20'),
    1::BIGINT,
    'admin promo statistics count the successful unique buyer'
);

SELECT extensions.is(
    ((public.admin_get_revenue_summary(now() - interval '1 hour', now() + interval '1 hour')->'currencies'->0->>'gross_collected')::NUMERIC),
    1800.00::NUMERIC,
    'owner revenue summary records collected cash'
);

SELECT extensions.is(
    ((public.admin_get_revenue_summary(now() - interval '1 hour', now() + interval '1 hour')->'currencies'->0->>'commissions')::NUMERIC),
    270.00::NUMERIC,
    'owner revenue summary subtracts approved promo commission as a business cost'
);

SELECT extensions.is(
    ((public.admin_get_revenue_summary(now() - interval '1 hour', now() + interval '1 hour')->'currencies'->0->>'contribution_profit')::NUMERIC),
    1530.00::NUMERIC,
    'contribution profit equals collected cash less refund and commission costs'
);

SELECT extensions.is(
    (SELECT status FROM public.admin_list_commissions('approved',100,0) WHERE promo_code = 'STAR20' LIMIT 1),
    'approved',
    'commission ledger exposes approved commission to admin only'
);

SELECT extensions.is(
    public.admin_create_commission_settlement(
        ARRAY[(SELECT commission_id FROM public.admin_list_commissions('approved',100,0) WHERE promo_code = 'STAR20' LIMIT 1)],
        'InstaPay',
        'PARTNER-PAYOUT-1',
        'Monthly partner settlement'
    )->>'currency',
    'EGP',
    'admin can settle approved commissions as a recorded payout'
);

SELECT extensions.is(
    (SELECT status FROM public.admin_list_commissions('paid',100,0) WHERE promo_code = 'STAR20' LIMIT 1),
    'paid',
    'settled commission becomes paid'
);

SELECT extensions.throws_ok(
    $$SELECT public.admin_refund_upgrade_order(
        (SELECT order_id FROM public.admin_list_commissions('paid',100,0) WHERE promo_code = 'STAR20' LIMIT 1),
        'Refund after partner payout',
        TRUE
    )$$,
    'SETTLED_COMMISSION_REFUND_REQUIRES_RECONCILIATION',
    'refund is blocked after partner commission payout instead of corrupting finance history'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000002',true);
SELECT public.create_upgrade_request('bank',NULL,9821,'STAR20');

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000003',true);
SELECT public.support_save_upgrade_order(
    (SELECT request_id FROM public.support_list_upgrade_requests(NULL,'buyer-two@test.local',50,0) LIMIT 1),
    6,2000,200,1800,'EGP','Second promo sale for refund'
);
SELECT public.support_record_upgrade_payment(
    (SELECT request_id FROM public.support_list_upgrade_requests(NULL,'buyer-two@test.local',50,0) LIMIT 1),
    1800,'EGP','InstaPay','PROMO-SECOND',NULL
);
SELECT public.support_activate_upgrade(
    (SELECT request_id FROM public.support_list_upgrade_requests(NULL,'buyer-two@test.local',50,0) LIMIT 1)
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000005',true);

SELECT extensions.is(
    public.admin_refund_upgrade_order(
        (SELECT order_id FROM public.support_list_upgrade_requests(NULL,'buyer-two@test.local',50,0) LIMIT 1),
        'Customer full refund',
        TRUE
    )->>'status',
    'refunded',
    'admin can fully refund an unsettled activated order'
);

SELECT extensions.is(
    (SELECT status FROM public.admin_list_commissions('reversed',100,0) WHERE promo_code = 'STAR20' LIMIT 1),
    'reversed',
    'refund reverses an unpaid partner commission'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000002',true);

SELECT extensions.ok(
    NOT public.has_premium_question_bank_access(9821),
    'refund with revoke access immediately removes premium entitlement while preserving grant history'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000004',true);

SELECT extensions.is(
    (SELECT activated_users FROM public.partner_get_coupon_summary() WHERE code = 'STAR20'),
    1::BIGINT,
    'refunded order is excluded from the promo owner successful-user count'
);

SELECT set_config('request.jwt.claim.sub','28000000-0000-0000-0000-000000000005',true);

SELECT extensions.is(
    ((public.admin_get_revenue_summary(now() - interval '1 hour', now() + interval '1 hour')->'currencies'->0->>'refunds')::NUMERIC),
    1800.00::NUMERIC,
    'owner revenue summary reports the full refund separately'
);

SELECT * FROM extensions.finish();
ROLLBACK;
