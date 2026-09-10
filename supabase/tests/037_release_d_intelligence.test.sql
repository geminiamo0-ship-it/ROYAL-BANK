BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(20);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '37000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','release-d-student@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '37000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','release-d-admin@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

UPDATE public.profiles
SET role = 'admin'
WHERE id = '37000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','37000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT public.admin_get_trial_analytics(now() - interval '30 days', now())$$,
    'ADMIN_ACCESS_REQUIRED',
    'student cannot read trial intelligence'
);
SELECT extensions.throws_ok(
    $$SELECT public.admin_get_product_analytics(now() - interval '30 days', now())$$,
    'ADMIN_ACCESS_REQUIRED',
    'student cannot read product intelligence'
);
SELECT extensions.throws_ok(
    $$SELECT public.admin_get_security_risk(now() - interval '30 days', now())$$,
    'ADMIN_ACCESS_REQUIRED',
    'student cannot read security intelligence'
);
SELECT extensions.throws_ok(
    $$SELECT public.admin_get_intelligence_report(now() - interval '30 days', now())$$,
    'ADMIN_ACCESS_REQUIRED',
    'student cannot generate intelligence reports'
);

SELECT set_config('request.jwt.claim.sub','37000000-0000-0000-0000-000000000002',true);

SELECT extensions.ok(
    public.admin_get_trial_analytics(now() - interval '30 days', now()) ? 'summary',
    'admin trial analytics returns a summary'
);
SELECT extensions.is(
    jsonb_typeof(public.admin_get_trial_analytics(now() - interval '30 days', now())->'by_bank'),
    'array',
    'trial analytics returns bank breakdown array'
);
SELECT extensions.ok(
    public.admin_get_product_analytics(now() - interval '30 days', now()) ? 'summary',
    'admin product analytics returns a summary'
);
SELECT extensions.ok(
    public.admin_get_security_risk(now() - interval '30 days', now()) ? 'summary',
    'admin security intelligence returns a summary'
);
SELECT extensions.is(
    jsonb_typeof(public.admin_get_intelligence_alerts()),
    'array',
    'live intelligence alerts return an array'
);
SELECT extensions.ok(
    public.admin_get_intelligence_report(now() - interval '30 days', now()) ? 'generated_at',
    'consolidated intelligence report is generated'
);

SELECT extensions.is(
    public.admin_block_ip('203.0.113.44'::inet, 'Release D pgTAP block')->>'ip_address',
    '203.0.113.44',
    'admin can block an IP through the audited RPC'
);
SELECT extensions.ok(
    EXISTS (SELECT 1 FROM public.ip_blocklist WHERE ip_address = '203.0.113.44'::inet),
    'blocked IP is persisted'
);
SELECT extensions.is(
    public.admin_unblock_ip('203.0.113.44'::inet, 'Release D pgTAP unblock')->>'status',
    'unblocked',
    'admin can unblock an IP through the audited RPC'
);
SELECT extensions.ok(
    NOT EXISTS (SELECT 1 FROM public.ip_blocklist WHERE ip_address = '203.0.113.44'::inet),
    'unblocked IP is removed from active blocklist'
);

SELECT extensions.is(
    (public.admin_set_manual_review(
        '37000000-0000-0000-0000-000000000001',
        TRUE,
        'Release D pgTAP manual review'
    )->>'manual_review_required')::BOOLEAN,
    TRUE,
    'admin can require manual security review'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
            public.admin_get_security_risk(now() - interval '1 day', now())->'accounts'
        ) AS account_row
        WHERE account_row->>'user_id' = '37000000-0000-0000-0000-000000000001'
          AND (account_row->>'manual_review_required')::BOOLEAN IS TRUE
    ),
    'manual review state is visible only through the audited admin risk RPC'
);
SELECT extensions.is(
    (public.admin_set_manual_review(
        '37000000-0000-0000-0000-000000000001',
        FALSE,
        'Release D pgTAP review cleared'
    )->>'manual_review_required')::BOOLEAN,
    FALSE,
    'admin can clear manual security review'
);

RESET ROLE;

SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.admin_get_trial_analytics(timestamptz,timestamptz)',
        'EXECUTE'
    ),
    'anonymous callers cannot execute trial intelligence RPC'
);
SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.admin_block_ip(inet,text)',
        'EXECUTE'
    ),
    'anonymous callers cannot execute IP block RPC'
);
SELECT extensions.ok(
    has_function_privilege(
        'authenticated',
        'public.admin_get_intelligence_report(timestamptz,timestamptz)',
        'EXECUTE'
    ),
    'authenticated sessions can reach report RPC for live admin role checks'
);

SELECT * FROM extensions.finish();
ROLLBACK;
