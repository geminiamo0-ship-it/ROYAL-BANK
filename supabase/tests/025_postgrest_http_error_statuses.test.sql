BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

SELECT extensions.ok(
    position(
        'PGRST' in pg_get_functiondef('api_hooks.royal_exam_pre_request()'::regprocedure)
    ) = 0,
    'gateway hook no longer uses custom PGRST JSON errors'
);

SELECT extensions.ok(
    position(
        'PGRST' in pg_get_functiondef(
            'public.record_exam_gateway_rate_limit_rejection(text)'::regprocedure
        )
    ) = 0,
    'rate-limit recorder no longer uses custom PGRST JSON errors'
);

UPDATE private.exam_gateway_config
SET enforcement_enabled = TRUE
WHERE singleton;

SELECT set_config('request.method', 'POST', true);
SELECT set_config('request.path', '/rest/v1/rpc/get_exam_session_window', true);
SELECT set_config('request.headers', '{}'::jsonb::text, true);

SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT403',
    'Exam gateway required',
    'gateway rejection maps directly to HTTP 403 instead of PGRST121/500'
);

SELECT set_config('request.royal_gateway_verified', '0', true);
SELECT extensions.throws_ok(
    $$SELECT public.record_exam_gateway_rate_limit_rejection('window')$$,
    'PT403',
    'Exam gateway required',
    'abuse recorder rejects unverified direct calls with HTTP 403'
);

-- With gateway proof present but no authenticated subject, the recorder must return 401.
SELECT set_config('request.royal_gateway_verified', '1', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}'::jsonb::text, true);
SELECT extensions.throws_ok(
    $$SELECT public.record_exam_gateway_rate_limit_rejection('window')$$,
    'PT401',
    'Authentication required',
    'abuse recorder maps missing authentication directly to HTTP 401'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f4000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','postgrest-status@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.royal_gateway_verified', '1', true);

SELECT extensions.throws_ok(
    $$SELECT public.record_exam_gateway_rate_limit_rejection('not-an-action')$$,
    'PT400',
    'Unsupported exam action',
    'unsupported recorder action maps directly to HTTP 400'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
