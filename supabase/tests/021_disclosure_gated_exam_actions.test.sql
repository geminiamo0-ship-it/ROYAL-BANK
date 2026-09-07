BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(14);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'f4000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','disclosure-tutor@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'f4000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','disclosure-timed@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways(id,name,slug)
VALUES (9960,'Disclosure Guard Pathway','test-disclosure-guard-pathway');

INSERT INTO public.question_banks(
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES (9961,9960,'Disclosure Guard Bank',FALSE,NULL,70);

INSERT INTO public.user_access_grants(user_id,scope_type,question_bank_id)
SELECT id,'bank',9961
FROM auth.users
WHERE id IN (
    'f4000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000002'
);

INSERT INTO public.questions(id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES
(996101,1996101,'Disclosure guard question 1','SECRET explanation 1','Disclosure','Guard','1'),
(996102,1996102,'Disclosure guard question 2','SECRET explanation 2','Disclosure','Guard','1');

INSERT INTO public.question_bank_questions(question_bank_id,question_id)
VALUES (9961,996101),(9961,996102);

INSERT INTO public.options(id,question_id,text_html,is_correct,option_order,percentage)
VALUES
(99610101,996101,'Q1 correct',TRUE,0,50),
(99610102,996101,'Q1 wrong 1',FALSE,1,20),
(99610103,996101,'Q1 wrong 2',FALSE,2,10),
(99610104,996101,'Q1 wrong 3',FALSE,3,10),
(99610105,996101,'Q1 wrong 4',FALSE,4,10),
(99610201,996102,'Q2 correct',TRUE,0,50),
(99610202,996102,'Q2 wrong 1',FALSE,1,20),
(99610203,996102,'Q2 wrong 2',FALSE,2,10),
(99610204,996102,'Q2 wrong 3',FALSE,3,10),
(99610205,996102,'Q2 wrong 4',FALSE,4,10);

CREATE TEMP TABLE disclosure_option_map(question_id BIGINT PRIMARY KEY, option_id BIGINT NOT NULL);
INSERT INTO disclosure_option_map VALUES (996101,99610101),(996102,99610201);
GRANT SELECT ON disclosure_option_map TO authenticated;

-- Tutor session: bootstrap discloses exactly Q1. Future locked ids are intentionally
-- present in session metadata, but they must not be actionable before disclosure.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE disclosure_tutor_bootstrap(payload JSONB);
INSERT INTO disclosure_tutor_bootstrap
SELECT public.create_exam_session_bootstrap(
    9961,'tutor',2,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

CREATE TEMP TABLE disclosure_tutor_ctx AS
WITH base AS (
    SELECT
        (payload->'session'->>'id')::uuid AS session_id,
        (payload->'questions'->0->>'id')::bigint AS disclosed_question_id
    FROM disclosure_tutor_bootstrap
)
SELECT
    base.session_id,
    base.disclosed_question_id,
    (
        SELECT tsq.question_id
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = base.session_id
          AND tsq.question_id <> base.disclosed_question_id
        LIMIT 1
    ) AS undisclosed_question_id
FROM base;

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::bigint
     FROM private.question_disclosures
     WHERE user_id='f4000000-0000-0000-0000-000000000001'),
    1::bigint,
    'bootstrap records only the question that was actually disclosed'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    format(
        'SELECT public.submit_exam_answer(%L::uuid,%s,%s,0)',
        (SELECT session_id::text FROM disclosure_tutor_ctx),
        (SELECT undisclosed_question_id FROM disclosure_tutor_ctx),
        (SELECT m.option_id FROM disclosure_option_map m JOIN disclosure_tutor_ctx c ON c.undisclosed_question_id=m.question_id)
    ),
    'QUESTION_NOT_DISCLOSED',
    'a future locked question cannot be submitted before disclosure'
);

SELECT extensions.throws_ok(
    format(
        'SELECT public.get_exam_question_feedback(%L::uuid,%s)',
        (SELECT session_id::text FROM disclosure_tutor_ctx),
        (SELECT undisclosed_question_id FROM disclosure_tutor_ctx)
    ),
    'QUESTION_NOT_DISCLOSED',
    'feedback cannot turn a future locked question id into an answer oracle'
);

SELECT extensions.throws_ok(
    format(
        'SELECT public.set_question_flag(%s,true)',
        (SELECT undisclosed_question_id FROM disclosure_tutor_ctx)
    ),
    'QUESTION_NOT_DISCLOSED',
    'an undisclosed question id cannot be used to seed flagged-only selection'
);

SELECT extensions.lives_ok(
    format(
        'SELECT public.submit_exam_answer(%L::uuid,%s,%s,0)',
        (SELECT session_id::text FROM disclosure_tutor_ctx),
        (SELECT disclosed_question_id FROM disclosure_tutor_ctx),
        (SELECT m.option_id FROM disclosure_option_map m JOIN disclosure_tutor_ctx c ON c.disclosed_question_id=m.question_id)
    ),
    'a genuinely disclosed tutor question still submits normally'
);

SELECT extensions.lives_ok(
    format(
        'SELECT public.get_exam_question_feedback(%L::uuid,%s)',
        (SELECT session_id::text FROM disclosure_tutor_ctx),
        (SELECT disclosed_question_id FROM disclosure_tutor_ctx)
    ),
    'earned tutor feedback remains available after answer submission'
);

SELECT extensions.lives_ok(
    format(
        'SELECT public.set_question_flag(%s,true)',
        (SELECT disclosed_question_id FROM disclosure_tutor_ctx)
    ),
    'a disclosed question can still be flagged normally'
);

RESET ROLE;
SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM public.user_question_flags f
        JOIN disclosure_tutor_ctx c ON c.disclosed_question_id=f.question_id
        WHERE f.user_id='f4000000-0000-0000-0000-000000000001'
    ),
    'the normal disclosed-question flag is persisted'
);

-- Timed session: End Block is allowed to finalize unseen questions as NULL answers,
-- but those bookkeeping rows must not reveal the correct option or explanation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-000000000002',true);

CREATE TEMP TABLE disclosure_timed_bootstrap(payload JSONB);
INSERT INTO disclosure_timed_bootstrap
SELECT public.create_exam_session_bootstrap(
    9961,'timed',2,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

CREATE TEMP TABLE disclosure_timed_ctx AS
WITH base AS (
    SELECT
        (payload->'session'->>'id')::uuid AS session_id,
        (payload->'questions'->0->>'id')::bigint AS disclosed_question_id
    FROM disclosure_timed_bootstrap
)
SELECT
    base.session_id,
    base.disclosed_question_id,
    (
        SELECT tsq.question_id
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = base.session_id
          AND tsq.question_id <> base.disclosed_question_id
        LIMIT 1
    ) AS undisclosed_question_id
FROM base;

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::bigint
     FROM private.question_disclosures
     WHERE user_id='f4000000-0000-0000-0000-000000000002'),
    1::bigint,
    'timed bootstrap also records only the actually disclosed question'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f4000000-0000-0000-0000-000000000002',true);

SELECT extensions.lives_ok(
    format(
        'SELECT public.complete_exam_session(%L::uuid)',
        (SELECT session_id::text FROM disclosure_timed_ctx)
    ),
    'timed End Block can still finalize unanswered questions safely'
);

CREATE TEMP TABLE disclosure_timed_answers AS
SELECT answers.*
FROM disclosure_timed_ctx c
CROSS JOIN LATERAL public.get_exam_session_answers(c.session_id) answers;

SELECT extensions.is(
    (SELECT count(*)::bigint FROM disclosure_timed_answers),
    2::bigint,
    'timed finalization still creates the expected answer-history rows'
);

SELECT extensions.ok(
    (SELECT a.correct_option_id IS NOT NULL
     FROM disclosure_timed_answers a
     JOIN disclosure_timed_ctx c ON c.disclosed_question_id=a.question_id),
    'the disclosed timed question may reveal its correct option after End Block'
);

SELECT extensions.ok(
    (SELECT a.correct_option_id IS NULL
     FROM disclosure_timed_answers a
     JOIN disclosure_timed_ctx c ON c.undisclosed_question_id=a.question_id),
    'an undisclosed timed-finalization row never reveals the correct option id'
);

SELECT extensions.throws_ok(
    format(
        'SELECT public.get_exam_question_feedback(%L::uuid,%s)',
        (SELECT session_id::text FROM disclosure_timed_ctx),
        (SELECT undisclosed_question_id FROM disclosure_timed_ctx)
    ),
    'QUESTION_NOT_DISCLOSED',
    'End Block does not unlock explanation feedback for a never-disclosed question'
);

SELECT * FROM extensions.finish();
ROLLBACK;
