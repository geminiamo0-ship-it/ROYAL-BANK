BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.is(
    (SELECT gateway_reject_threshold FROM private.exam_security_config WHERE singleton),
    10,
    'ten rejected gateway requests trigger an escalation by default'
);

SELECT extensions.is(
    (SELECT gateway_first_block FROM private.exam_security_config WHERE singleton),
    interval '15 minutes',
    'first repeated-429 escalation blocks new content for 15 minutes'
);

SELECT extensions.ok(
    has_function_privilege(
        'authenticated',
        'public.record_exam_gateway_rate_limit_rejection(text)'::regprocedure,
        'EXECUTE'
    ),
    'authenticated gateway traffic can call the rejection recorder'
);

SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.record_exam_gateway_rate_limit_rejection(text)'::regprocedure,
        'EXECUTE'
    ),
    'anonymous clients cannot call the rejection recorder'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f3000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','gateway-rate-limit@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

-- Lower only the test threshold so we can exercise all three escalation levels
-- without generating a large number of calls. ROLLBACK restores production defaults.
UPDATE private.exam_security_config
SET gateway_reject_threshold = 2
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.royal_gateway_verified','0',true);

SELECT extensions.throws_ok(
    $$SELECT public.record_exam_gateway_rate_limit_rejection('window')$$,
    'PT403',
    'Exam gateway required',
    'a client cannot self-record or manipulate abuse state without gateway verification'
);

SELECT set_config('request.royal_gateway_verified','1',true);

-- First 2 rejected requests => level 1 / 15 minutes.
SELECT public.record_exam_gateway_rate_limit_rejection('window');
SELECT public.record_exam_gateway_rate_limit_rejection('window');

RESET ROLE;

SELECT extensions.is(
    (SELECT gateway_escalation_count FROM private.exam_security_account_state
     WHERE user_id = 'f3000000-0000-0000-0000-000000000001'),
    1,
    'first rejection burst records escalation level one'
);

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM private.exam_security_account_state state
        WHERE state.user_id = 'f3000000-0000-0000-0000-000000000001'
          AND state.question_block_reason = 'RATE_LIMITED'
          AND state.session_create_block_reason = 'RATE_LIMITED'
          AND state.question_blocked_until > clock_timestamp() + interval '14 minutes'
          AND state.session_create_blocked_until > clock_timestamp() + interval '14 minutes'
    ),
    'first escalation scopes a 15-minute block to new questions and new sessions'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.royal_gateway_verified','1',true);

-- Next 2 => level 2 / 1 hour.
SELECT public.record_exam_gateway_rate_limit_rejection('submit');
SELECT public.record_exam_gateway_rate_limit_rejection('submit');

RESET ROLE;

SELECT extensions.is(
    (SELECT gateway_escalation_count FROM private.exam_security_account_state
     WHERE user_id = 'f3000000-0000-0000-0000-000000000001'),
    2,
    'second rejection burst records escalation level two'
);

SELECT extensions.ok(
    (SELECT question_blocked_until > clock_timestamp() + interval '55 minutes'
     FROM private.exam_security_account_state
     WHERE user_id = 'f3000000-0000-0000-0000-000000000001'),
    'second escalation extends the new-content cooldown to about one hour'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.royal_gateway_verified','1',true);

-- Next 2 => level 3 / 3 hours + high risk.
SELECT public.record_exam_gateway_rate_limit_rejection('create');
SELECT public.record_exam_gateway_rate_limit_rejection('create');

RESET ROLE;

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM private.exam_security_account_state state
        WHERE state.user_id = 'f3000000-0000-0000-0000-000000000001'
          AND state.gateway_escalation_count = 3
          AND state.risk_score >= 75
          AND state.question_blocked_until > clock_timestamp() + interval '2 hours 50 minutes'
          AND state.session_create_blocked_until > clock_timestamp() + interval '2 hours 50 minutes'
    ),
    'third escalation applies a three-hour scoped cooldown and high-risk score'
);

SELECT extensions.is(
    (SELECT count(*)::INTEGER
     FROM private.exam_security_events
     WHERE user_id = 'f3000000-0000-0000-0000-000000000001'
       AND event_type = 'gateway_rate_limit_escalated'),
    3,
    'only escalation events are written, not one event row per rejected request'
);

SELECT extensions.ok(
    NOT (SELECT manual_review_required
         FROM private.exam_security_account_state
         WHERE user_id = 'f3000000-0000-0000-0000-000000000001'),
    'third escalation raises risk without automatically locking the whole account'
);

SELECT extensions.is(
    (SELECT gateway_reject_count FROM private.exam_security_account_state
     WHERE user_id = 'f3000000-0000-0000-0000-000000000001'),
    0,
    'rejection counter resets after each completed escalation burst'
);

SELECT * FROM extensions.finish();
ROLLBACK;
