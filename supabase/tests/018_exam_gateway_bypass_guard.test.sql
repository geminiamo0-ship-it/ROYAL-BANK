BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(17);

SELECT extensions.ok(
    NOT (SELECT enforcement_enabled FROM private.exam_gateway_config WHERE singleton),
    'gateway enforcement is disabled by default for staged rollout'
);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'private.exam_gateway_keys', 'SELECT'),
    'authenticated cannot read gateway key digests'
);

SELECT extensions.ok(
    NOT has_table_privilege('anon', 'private.exam_gateway_keys', 'SELECT'),
    'anon cannot read gateway key digests'
);

SELECT extensions.ok(
    to_regprocedure('public.royal_exam_pre_request()') IS NULL,
    'pre-request hook is not present in the exposed public RPC schema'
);

SELECT extensions.ok(
    has_schema_privilege('authenticated', 'api_hooks', 'USAGE'),
    'authenticated API role can resolve the hidden hook schema'
);

SELECT extensions.ok(
    has_function_privilege('authenticated', 'api_hooks.royal_exam_pre_request()'::regprocedure, 'EXECUTE'),
    'authenticated can execute the registered hidden pre-request hook'
);

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM pg_db_role_setting s
        JOIN pg_roles r ON r.oid = s.setrole
        CROSS JOIN LATERAL unnest(s.setconfig) cfg
        WHERE r.rolname = 'authenticator'
          AND cfg = 'pgrst.db_pre_request=api_hooks.royal_exam_pre_request'
    ),
    'authenticator is configured to call the hidden royal exam pre-request hook'
);

-- Seed the same live Auth identity used by the pre-request tests. PostgREST normally
-- provides request.jwt.claim.sub after JWT verification; set it explicitly here.
INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f2000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','gateway-signal@test.local','',now(),
    '{"provider":"email","providers":["email"],"must_change_password":false}'::jsonb,
    '{}'::jsonb,now(),now()
);
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000001', true);

-- Disabling the gateway transport control must not disable the authoritative user
-- guard, but a healthy live user remains allowed.
SELECT set_config('request.method', 'POST', true);
SELECT set_config('request.path', '/rest/v1/rpc/get_exam_session_window', true);
SELECT set_config('request.headers', '{}'::jsonb::text, true);
SELECT extensions.lives_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'protected RPC allows a live authenticated user while gateway enforcement is staged off'
);

UPDATE auth.users
SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{must_change_password}', 'true'::jsonb, true)
WHERE id = 'f2000000-0000-0000-0000-000000000001';
SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT403',
    'PASSWORD_CHANGE_REQUIRED',
    'live must_change_password state blocks protected exam RPCs even when gateway enforcement is off'
);
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{must_change_password}', 'false'::jsonb, true)
WHERE id = 'f2000000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000099', true);
SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT401',
    'INVALID_AUTH_TOKEN',
    'a JWT subject with no live auth.users row is rejected'
);
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000001', true);

UPDATE auth.users
SET banned_until = clock_timestamp() + interval '1 hour'
WHERE id = 'f2000000-0000-0000-0000-000000000001';
SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT403',
    'ACCOUNT_BANNED',
    'a currently banned Auth user is rejected before a protected exam RPC executes'
);
UPDATE auth.users
SET banned_until = NULL
WHERE id = 'f2000000-0000-0000-0000-000000000001';

INSERT INTO private.exam_gateway_keys(key_id, secret_digest)
VALUES ('test-key', extensions.digest('correct-horse-battery-staple', 'sha256'));
UPDATE private.exam_gateway_config
SET enforcement_enabled = TRUE
WHERE singleton;

-- Protected exam RPCs are POST-only. Read-only PostgREST GET/HEAD invocation must
-- not skip the BFF/gateway controls.
SELECT set_config('request.method', 'GET', true);
SELECT set_config('request.headers', '{}'::jsonb::text, true);
SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT405',
    'Protected exam RPCs require POST',
    'GET cannot bypass the exam gateway on a protected RPC'
);

SELECT set_config('request.method', 'HEAD', true);
SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT405',
    'Protected exam RPCs require POST',
    'HEAD cannot bypass the exam gateway on a protected RPC'
);

SELECT set_config('request.method', 'POST', true);
SELECT set_config('request.headers', '{"x-royal-gateway-key-id":"test-key","x-royal-gateway-key":"wrong"}'::jsonb::text, true);
SELECT extensions.throws_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'PT403',
    'Exam gateway required',
    'invalid gateway key is rejected as HTTP 403 before a protected RPC executes'
);

SELECT set_config(
    'request.headers',
    '{"x-royal-gateway-key-id":"test-key","x-royal-gateway-key":"correct-horse-battery-staple","x-royal-ip-hmac":"ip-proof","x-royal-ua-hmac":"ua-proof"}'::jsonb::text,
    true
);
SELECT extensions.lives_ok(
    'SELECT api_hooks.royal_exam_pre_request()',
    'valid gateway key plus live Auth user is accepted'
);

SELECT extensions.is(
    current_setting('request.royal_gateway_verified', true),
    '1',
    'valid gateway request receives a DB-side verified marker'
);

INSERT INTO public.questions(id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (998001,1998001,'Gateway signal question','SECRET','Gateway','Signal','1');

INSERT INTO private.question_disclosures(user_id, question_id, first_disclosed_at)
VALUES ('f2000000-0000-0000-0000-000000000001', 998001, clock_timestamp());

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = 'f2000000-0000-0000-0000-000000000001'
          AND d.question_id = 998001
          AND d.first_ip_hmac = 'ip-proof'
          AND d.first_user_agent_hmac = 'ua-proof'
    ),
    'IP and User-Agent HMAC signals are captured only after gateway verification'
);

SELECT * FROM extensions.finish();
ROLLBACK;
