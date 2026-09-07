BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(31);

SELECT extensions.is(
    (SELECT session_daily_limit FROM private.exam_security_config WHERE singleton),
    14,
    'production session rolling-24h limit is 14'
);

SELECT extensions.is(
    (SELECT question_soft_limit FROM private.exam_security_config WHERE singleton),
    300,
    'production question cooldown threshold is 300'
);

SELECT extensions.is(
    (SELECT question_daily_limit FROM private.exam_security_config WHERE singleton),
    650,
    'production question rolling-24h hard cap is 650'
);

SELECT extensions.ok(
    NOT has_function_privilege(
        'authenticated',
        'private.get_exam_session_window_core(uuid,integer,integer)'::regprocedure,
        'EXECUTE'
    ),
    'authenticated cannot bypass the protected window wrapper through its private core'
);

SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.create_exam_session_bootstrap_idempotent(uuid,bigint,text,integer,text[],text[],jsonb,text)'::regprocedure,
        'EXECUTE'
    ),
    'anon cannot execute idempotent exam creation'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
('00000000-0000-0000-0000-000000000000','f1000000-0000-0000-0000-000000000001','authenticated','authenticated','guard-idem@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-0000-0000-000000000002','authenticated','authenticated','guard-daily@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-0000-0000-000000000003','authenticated','authenticated','guard-burst@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-0000-0000-000000000004','authenticated','authenticated','guard-active@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-0000-0000-000000000005','authenticated','authenticated','guard-question@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','f1000000-0000-0000-0000-000000000006','authenticated','authenticated','guard-manual@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways(id,name,slug)
VALUES (9970,'Abuse Guardrail Pathway','test-abuse-guardrail-pathway');

INSERT INTO public.question_banks(
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES (9971,9970,'Abuse Guardrail Bank',FALSE,NULL,70);

INSERT INTO public.user_access_grants(user_id,scope_type,question_bank_id)
SELECT id,'bank',9971
FROM auth.users
WHERE id IN (
    'f1000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000004',
    'f1000000-0000-0000-0000-000000000005',
    'f1000000-0000-0000-0000-000000000006'
);

INSERT INTO public.questions(id,main_id,text_html,explanation_html,category,topic,difficulty)
SELECT
    997100 + n,
    1997100 + n,
    'Guardrail question ' || n,
    'SECRET guardrail explanation ' || n,
    'Guardrail',
    'Topic ' || n,
    '1'
FROM generate_series(1,10) AS n;

INSERT INTO public.question_bank_questions(question_bank_id,question_id)
SELECT 9971, 997100 + n
FROM generate_series(1,10) AS n;

INSERT INTO public.options(id,question_id,text_html,is_correct,option_order,percentage)
SELECT 99710000 + n * 10 + 1, 997100 + n, 'Correct ' || n, TRUE, 0, 60
FROM generate_series(1,10) AS n
UNION ALL
SELECT 99710000 + n * 10 + 2, 997100 + n, 'Incorrect ' || n, FALSE, 1, 40
FROM generate_series(1,10) AS n;

-- Idempotency: same key + same input returns the same session and only inserts once.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE guard_idem_a(payload jsonb);
CREATE TEMP TABLE guard_idem_b(payload jsonb);
INSERT INTO guard_idem_a
SELECT public.create_exam_session_bootstrap_idempotent(
    '11111111-aaaa-bbbb-cccc-111111111111',
    9971,'tutor',2,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
INSERT INTO guard_idem_b
SELECT public.create_exam_session_bootstrap_idempotent(
    '11111111-aaaa-bbbb-cccc-111111111111',
    9971,'tutor',2,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT extensions.is(
    (SELECT payload FROM guard_idem_a),
    (SELECT payload FROM guard_idem_b),
    'idempotent create returns the exact same bootstrap response'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_sessions
     WHERE user_id='f1000000-0000-0000-0000-000000000001'),
    1::bigint,
    'idempotent replay creates exactly one database session'
);

SELECT extensions.is(
    (SELECT count(*)::bigint FROM private.question_disclosures
     WHERE user_id='f1000000-0000-0000-0000-000000000001'),
    1::bigint,
    'bootstrap records only the actually disclosed Q1'
);

SELECT extensions.ok(
    NOT (SELECT (payload->'questions'->0) ? 'explanation_html' FROM guard_idem_a),
    'bootstrap still never exposes future explanation_html'
);

SELECT extensions.ok(
    NOT (SELECT (payload->'questions'->0->'options'->0) ? 'is_correct' FROM guard_idem_a),
    'bootstrap still never exposes future option correctness'
);

-- Daily session cap: lower only inside this rolled-back test to exercise it cheaply.
UPDATE private.exam_security_config
SET session_daily_limit=2, session_burst_limit=99, active_session_limit=99
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all')$$,
    'DAILY_SESSION_LIMIT',
    'session number 15 equivalent is rejected while the configured final allowed session succeeds'
);
RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_sessions
     WHERE user_id='f1000000-0000-0000-0000-000000000002'),
    2::bigint,
    'daily session rejection does not insert an extra session'
);

-- Burst cap: the final allowed session persists a cooldown; the next create is rejected.
UPDATE private.exam_security_config
SET session_daily_limit=14, session_burst_limit=2, active_session_limit=99
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000003',true);
SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all')$$,
    'SESSION_BURST_LIMIT',
    'session burst cooldown rejects further session creation'
);
RESET ROLE;
SELECT extensions.ok(
    (SELECT session_create_blocked_until > now()
     FROM private.exam_security_account_state
     WHERE user_id='f1000000-0000-0000-0000-000000000003'),
    'session burst writes a temporary create-session cooldown'
);

-- Concurrent active leases: release on completion immediately frees a slot.
UPDATE private.exam_security_config
SET session_burst_limit=99, active_session_limit=2
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000004',true);
CREATE TEMP TABLE guard_active_one(payload jsonb);
CREATE TEMP TABLE guard_active_two(payload jsonb);
INSERT INTO guard_active_one
SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
INSERT INTO guard_active_two
SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all')$$,
    'TOO_MANY_ACTIVE_SESSIONS',
    'a user cannot activate more than the configured concurrent-session lease limit'
);
SELECT public.complete_exam_session(
    (SELECT (payload->'session'->>'id')::uuid FROM guard_active_one)
);
SELECT extensions.lives_ok(
    $$SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all')$$,
    'completing a session releases its lease so another session can start'
);
RESET ROLE;

-- Question disclosure rules: cheap test thresholds exercise the exact production logic.
UPDATE private.exam_security_config
SET
    active_session_limit=99,
    question_burst_limit=3,
    question_soft_limit=5,
    question_daily_limit=7,
    max_new_questions_per_window=3
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000005',true);
CREATE TEMP TABLE guard_question(payload jsonb);
INSERT INTO guard_question
SELECT public.create_exam_session_bootstrap(9971,'tutor',8,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');

SELECT extensions.throws_ok(
    $$SELECT public.get_exam_session_window(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_question),3,1
    )$$,
    'QUESTION_WINDOW_OUT_OF_SEQUENCE',
    'fresh question content cannot be jumped ahead of the first undisclosed frontier'
);

CREATE TEMP TABLE guard_burst_window(payload jsonb);
INSERT INTO guard_burst_window
SELECT public.get_exam_session_window(
    (SELECT (payload->'session'->>'id')::uuid FROM guard_question),1,5
);
SELECT extensions.is(
    (SELECT jsonb_array_length(payload) FROM guard_burst_window),
    2,
    'window is truncated exactly at the fresh-question burst threshold instead of overshooting'
);
SELECT extensions.ok(
    NOT (SELECT (payload->0) ? 'explanation_html' FROM guard_burst_window),
    'safe window remains explanation-free after disclosure enforcement'
);

RESET ROLE;
SELECT extensions.ok(
    (SELECT question_blocked_until > now()
     FROM private.exam_security_account_state
     WHERE user_id='f1000000-0000-0000-0000-000000000005'),
    'reaching the fresh-question burst threshold creates a cooldown'
);

-- Clear the test-only burst cooldown and remove burst as the next binding threshold.
UPDATE private.exam_security_account_state
SET question_blocked_until=now()-interval '1 second', question_block_reason=NULL
WHERE user_id='f1000000-0000-0000-0000-000000000005';
UPDATE private.exam_security_config
SET question_burst_limit=99
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000005',true);
CREATE TEMP TABLE guard_soft_window(payload jsonb);
INSERT INTO guard_soft_window
SELECT public.get_exam_session_window(
    (SELECT (payload->'session'->>'id')::uuid FROM guard_question),3,5
);
SELECT extensions.is(
    (SELECT jsonb_array_length(payload) FROM guard_soft_window),
    2,
    'window stops exactly at the 300-equivalent cooldown threshold'
);
RESET ROLE;
SELECT extensions.ok(
    (SELECT question_blocked_until > now() AND session_create_blocked_until > now()
     FROM private.exam_security_account_state
     WHERE user_id='f1000000-0000-0000-0000-000000000005'),
    '300-equivalent threshold blocks new disclosure and new session creation for the cooldown'
);

UPDATE private.exam_security_account_state
SET
    question_blocked_until=now()-interval '1 second',
    question_block_reason=NULL,
    session_create_blocked_until=now()-interval '1 second',
    session_create_block_reason=NULL
WHERE user_id='f1000000-0000-0000-0000-000000000005';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000005',true);
CREATE TEMP TABLE guard_daily_window(payload jsonb);
INSERT INTO guard_daily_window
SELECT public.get_exam_session_window(
    (SELECT (payload->'session'->>'id')::uuid FROM guard_question),5,3
);
SELECT extensions.is(
    (SELECT jsonb_array_length(payload) FROM guard_daily_window),
    2,
    'window stops exactly at the 650-equivalent hard daily cap'
);
SELECT extensions.throws_ok(
    $$SELECT public.get_exam_session_window(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_question),7,1
    )$$,
    'DAILY_CONTENT_LIMIT',
    'hard daily content cap blocks the next NEW question'
);
SELECT extensions.is(
    jsonb_array_length(public.get_exam_session_window(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_question),0,1
    )),
    1,
    'already-disclosed questions remain readable at the hard daily cap'
);
SELECT extensions.lives_ok(
    $$SELECT public.submit_exam_answer_with_feedback(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_question),
        (SELECT (payload->'questions'->0->>'id')::bigint FROM guard_question),
        (SELECT (payload->'questions'->0->'options'->0->>'id')::bigint FROM guard_question),
        1
    )$$,
    'hard disclosure cap does not block answer submission or earned feedback'
);
SELECT extensions.lives_ok(
    $$SELECT public.complete_exam_session(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_question)
    )$$,
    'hard disclosure cap does not block completion of the current session'
);
RESET ROLE;

-- Consecutive Cairo cap dates escalate to a reversible manual-review lock.
UPDATE private.exam_security_config
SET question_burst_limit=99, question_soft_limit=999, question_daily_limit=7
WHERE singleton;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000006',true);
CREATE TEMP TABLE guard_manual(payload jsonb);
INSERT INTO guard_manual
SELECT public.create_exam_session_bootstrap(9971,'tutor',8,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all');
RESET ROLE;

-- Seed five additional already-disclosed questions so the next legitimate fresh
-- question reaches the hard cap. This is test fixture setup, not application behavior.
INSERT INTO private.question_disclosures(
    user_id,question_id,first_bank_id,first_session_id,first_disclosed_at
)
SELECT
    'f1000000-0000-0000-0000-000000000006'::uuid,
    qid.value::text::bigint,
    9971,
    (SELECT (payload->'session'->>'id')::uuid FROM guard_manual),
    now()
FROM guard_manual,
LATERAL jsonb_array_elements(guard_manual.payload->'question_ids') WITH ORDINALITY AS qid(value, ordinality)
WHERE qid.ordinality <= 6
ON CONFLICT (user_id,question_id) DO NOTHING;

INSERT INTO private.exam_security_account_state(
    user_id,last_question_cap_cairo_date,consecutive_question_cap_days,updated_at
) VALUES (
    'f1000000-0000-0000-0000-000000000006',
    ((now() AT TIME ZONE 'Africa/Cairo')::date - 1),
    1,
    now()
)
ON CONFLICT (user_id) DO UPDATE
SET
    question_blocked_until=NULL,
    question_block_reason=NULL,
    session_create_blocked_until=NULL,
    session_create_block_reason=NULL,
    manual_review_required=FALSE,
    manual_review_reason=NULL,
    last_question_cap_cairo_date=EXCLUDED.last_question_cap_cairo_date,
    consecutive_question_cap_days=1,
    updated_at=now();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000006',true);
SELECT extensions.is(
    jsonb_array_length(public.get_exam_session_window(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_manual),6,1
    )),
    1,
    'second consecutive Cairo-day hard-cap question itself is allowed'
);
RESET ROLE;
SELECT extensions.ok(
    (SELECT manual_review_required
     FROM private.exam_security_account_state
     WHERE user_id='f1000000-0000-0000-0000-000000000006'),
    'two consecutive Cairo cap dates escalate to manual review'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000006',true);
SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session_bootstrap(9971,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all')$$,
    'MANUAL_REVIEW_REQUIRED',
    'manual review lock prevents new session creation'
);
SELECT extensions.is(
    jsonb_array_length(public.get_exam_session_window(
        (SELECT (payload->'session'->>'id')::uuid FROM guard_manual),0,1
    )),
    1,
    'manual review lock still permits previously disclosed content'
);

SELECT * FROM extensions.finish();
ROLLBACK;
