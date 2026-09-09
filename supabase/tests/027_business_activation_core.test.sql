BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(15);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '27000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','buyer@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '27000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','support@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '27000000-0000-0000-0000-000000000003',
    'authenticated','authenticated','partner@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles
SET role = 'support'
WHERE id = '27000000-0000-0000-0000-000000000002';

INSERT INTO public.pathways (id,name,slug)
VALUES (9710,'Business Test Pathway','test-business-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES (
    9721,9710,'Business Test Bank',TRUE,2,70,10
);

INSERT INTO public.promo_codes (
    code,
    owner_user_id,
    discount_type,
    discount_value,
    commission_type,
    commission_value,
    commission_basis,
    created_by
) VALUES (
    'STAR10',
    '27000000-0000-0000-0000-000000000003',
    'percentage',
    10,
    'percentage',
    15,
    'amount_paid',
    '27000000-0000-0000-0000-000000000002'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    public.create_upgrade_request('bank',NULL,9721,'STAR10')->>'status',
    'pending',
    'student can create a pending bank upgrade request'
);

SELECT extensions.ok(
    (public.create_upgrade_request('bank',NULL,9721,'STAR10')->>'public_code') ~ '^RY-[A-F0-9]{8}$',
    'upgrade request exposes a short support-safe public code'
);

SELECT extensions.is(
    public.create_upgrade_request('bank',NULL,9721,'STAR10')->>'promo_applied',
    'true',
    'valid promo is attached to the request'
);

SELECT extensions.is(
    public.create_upgrade_request('bank',NULL,9721,'STAR10')->>'public_code',
    public.create_upgrade_request('bank',NULL,9721,'STAR10')->>'public_code',
    'repeating the same open request is idempotent'
);

SELECT extensions.throws_ok(
    $$SELECT * FROM public.support_list_upgrade_requests(NULL,NULL,50,0)$$,
    'SUPPORT_ACCESS_REQUIRED',
    'ordinary students cannot use support business RPCs'
);

SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000002',true);

SELECT extensions.is(
    public.support_mark_upgrade_contacted(
        (SELECT request_id
         FROM public.support_list_upgrade_requests(NULL,'buyer@test.local',50,0)
         LIMIT 1)
    )->>'status',
    'contacted',
    'support can mark the request contacted'
);

SELECT extensions.is(
    public.support_save_upgrade_order(
        (SELECT request_id
         FROM public.support_list_upgrade_requests(NULL,'buyer@test.local',50,0)
         LIMIT 1),
        6,
        2000,
        200,
        1800,
        'EGP',
        'Manual Telegram sale'
    )->>'status',
    'awaiting_payment',
    'support can create the commercial order without granting access'
);

SELECT extensions.throws_ok(
    $$SELECT public.support_activate_upgrade(
        (SELECT request_id
         FROM public.support_list_upgrade_requests(NULL,'buyer@test.local',50,0)
         LIMIT 1)
    )$$,
    'PAYMENT_REQUIRED',
    'activation is blocked until confirmed payment covers the agreed price'
);

SELECT extensions.is(
    public.support_record_upgrade_payment(
        (SELECT request_id
         FROM public.support_list_upgrade_requests(NULL,'buyer@test.local',50,0)
         LIMIT 1),
        1800,
        'EGP',
        'InstaPay',
        'TEST-REFERENCE',
        'Verified manually by support'
    )->>'paid_enough',
    'true',
    'support can record a confirmed manual payment'
);

SELECT extensions.is(
    public.support_activate_upgrade(
        (SELECT request_id
         FROM public.support_list_upgrade_requests(NULL,'buyer@test.local',50,0)
         LIMIT 1)
    )->>'status',
    'activated',
    'paid request activates successfully'
);

SELECT extensions.is(
    public.support_activate_upgrade(
        (SELECT request_id
         FROM public.support_list_upgrade_requests('activated','buyer@test.local',50,0)
         LIMIT 1)
    )->>'already_activated',
    'true',
    'activation is idempotent on repeated support clicks'
);

RESET ROLE;

SELECT extensions.is(
    (
        SELECT count(*)::INTEGER
        FROM public.user_access_grants
        WHERE user_id = '27000000-0000-0000-0000-000000000001'
          AND scope_type = 'bank'
          AND question_bank_id = 9721
    ),
    1,
    'successful activation creates exactly one authoritative access grant'
);

SELECT extensions.is(
    (
        SELECT commission_amount
        FROM public.commissions
        WHERE partner_user_id = '27000000-0000-0000-0000-000000000003'
    ),
    270.00::NUMERIC,
    'commission is created only after successful activation from the paid amount'
);

SELECT extensions.is(
    (
        SELECT status
        FROM public.upgrade_requests
        WHERE user_id = '27000000-0000-0000-0000-000000000001'
          AND question_bank_id = 9721
    ),
    'activated',
    'upgrade request lifecycle finishes as activated'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    public.has_premium_question_bank_access(9721),
    'activated grant is recognized by the existing premium access authority'
);

SELECT * FROM extensions.finish();
ROLLBACK;
