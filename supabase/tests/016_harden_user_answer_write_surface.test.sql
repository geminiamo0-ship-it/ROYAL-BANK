BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '76000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','answer-surface@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9760,'Answer Surface Pathway','test-answer-surface-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
)
VALUES (9860,9760,'Answer Surface Bank',FALSE,NULL,70);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('76000000-0000-0000-0000-000000000001','bank',9860);

INSERT INTO public.questions (
    id,main_id,text_html,explanation_html,category,topic,difficulty
) VALUES
    (99601,299601,'Answer Surface Q1','Explanation Q1','Medicine','Topic','1'),
    (99602,299602,'Answer Surface Q2','Explanation Q2','Medicine','Topic','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
    (9860,99601),(9860,99602);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
    (997011,99601,'Q1 Correct',TRUE,0,65),
    (997012,99601,'Q1 Wrong',FALSE,1,35),
    (997021,99602,'Q2 Correct',TRUE,0,55),
    (997022,99602,'Q2 Wrong',FALSE,1,45);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.user_answers','INSERT'),
    'authenticated cannot INSERT directly into user_answers'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.user_answers','UPDATE'),
    'authenticated cannot UPDATE user_answers directly'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.user_answers','DELETE'),
    'authenticated cannot DELETE user_answers directly'
);
SELECT extensions.ok(
    NOT has_table_privilege('anon','public.user_answers','INSERT'),
    'anon cannot INSERT directly into user_answers'
);
SELECT extensions.ok(
    has_function_privilege(
        'authenticated',
        'public.submit_exam_answer_with_feedback(uuid,bigint,bigint,integer)',
        'EXECUTE'
    ),
    'authenticated keeps execute on submit_exam_answer_with_feedback'
);
SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.submit_exam_answer_with_feedback(uuid,bigint,bigint,integer)',
        'EXECUTE'
    ),
    'anon cannot execute submit_exam_answer_with_feedback'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','76000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE answer_surface_standard_session(id uuid);
INSERT INTO answer_surface_standard_session
SELECT public.create_exam_session(
    '76000000-0000-0000-0000-000000000001',
    9860,'standard',2,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

CREATE TEMP TABLE answer_surface_feedback(payload jsonb);
INSERT INTO answer_surface_feedback
SELECT public.submit_exam_answer_with_feedback(
    (SELECT id FROM answer_surface_standard_session),
    99601,
    997011,
    7
);

CREATE TEMP TABLE answer_surface_timed_session(id uuid);
INSERT INTO answer_surface_timed_session
SELECT public.create_exam_session(
    '76000000-0000-0000-0000-000000000001',
    9860,'timed',2,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT public.submit_exam_answer(
    (SELECT id FROM answer_surface_timed_session),
    99601,
    997011,
    5
);
SELECT public.complete_exam_session((SELECT id FROM answer_surface_timed_session));

RESET ROLE;

SELECT extensions.is(
    (SELECT COUNT(*)::integer
     FROM public.test_session_questions
     WHERE test_session_id=(SELECT id FROM answer_surface_standard_session)),
    2,
    'standard RPC session still locks the requested questions'
);

SELECT extensions.ok(
    (SELECT (payload->'answer'->>'is_correct')::boolean
            AND (payload->'feedback'->>'is_correct')::boolean
            AND (payload->'feedback'->>'correct_option_id')::bigint = 997011
            AND payload->'feedback'->>'explanation_html' = 'Explanation Q1'
     FROM answer_surface_feedback),
    'inline answer RPC still stores and returns authoritative feedback'
);

SELECT extensions.ok(
    (SELECT is_completed
     FROM public.test_sessions
     WHERE id=(SELECT id FROM answer_surface_timed_session)),
    'timed completion still succeeds through the trusted RPC path'
);

SELECT extensions.ok(
    (SELECT COUNT(*) = 2
            AND COUNT(*) FILTER (WHERE question_id=99602 AND selected_option_id IS NULL AND is_correct=FALSE) = 1
     FROM public.user_answers
     WHERE test_session_id=(SELECT id FROM answer_surface_timed_session)),
    'timed completion still records unanswered questions server-side'
);

SELECT * FROM extensions.finish();
ROLLBACK;
