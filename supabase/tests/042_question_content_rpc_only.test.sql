BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1
        FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name IN ('questions','options','question_bank_questions')
          AND grantee IN ('anon','authenticated')
    ),
    'browser roles have no table privileges on question content tables'
);

SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name IN ('questions','options','question_bank_questions')
          AND grantee IN ('anon','authenticated')
    ),
    'browser roles have no column privileges on question content tables'
);

SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'questions'
          AND policyname = 'Authenticated users can read questions'
    ),
    'legacy unconditional question read policy is removed'
);

SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'options'
          AND policyname = 'Authenticated users can read options'
    ),
    'legacy unconditional option read policy is removed'
);

SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'question_bank_questions'
          AND policyname = 'Authenticated users can read question_bank_questions'
    ),
    'legacy unconditional mapping read policy is removed'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'fa000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','rpc-only-content@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways(id,name,slug)
VALUES (9940,'RPC-only Content Pathway','rpc-only-content-pathway');

INSERT INTO public.question_banks(
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES (9941,9940,'RPC-only Content Bank',FALSE,NULL,70);

INSERT INTO public.user_access_grants(user_id,scope_type,question_bank_id)
VALUES ('fa000000-0000-0000-0000-000000000001','bank',9941);

INSERT INTO public.questions(id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (994101,1994101,'RPC-only question','RPC-only explanation','Security','RPC','1');

INSERT INTO public.question_bank_questions(question_bank_id,question_id)
VALUES (9941,994101);

INSERT INTO public.options(id,question_id,text_html,is_correct,option_order,percentage)
VALUES
(99410101,994101,'Correct option',TRUE,0,50),
(99410102,994101,'Wrong option',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','fa000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    'SELECT id,text_html FROM public.questions LIMIT 1',
    '42501',
    'permission denied for table questions',
    'direct question text reads are denied even to an entitled active user'
);

SELECT extensions.throws_ok(
    'SELECT id,text_html FROM public.options LIMIT 1',
    '42501',
    'permission denied for table options',
    'direct option text reads are denied even to an entitled active user'
);

SELECT extensions.throws_ok(
    'SELECT question_id FROM public.question_bank_questions LIMIT 1',
    '42501',
    'permission denied for table question_bank_questions',
    'direct bank-question mapping reads are denied'
);

CREATE TEMP TABLE rpc_only_bootstrap(payload jsonb);
INSERT INTO rpc_only_bootstrap
SELECT public.create_exam_session_bootstrap(
    9941,'tutor',1,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT extensions.is(
    (SELECT payload->'questions'->0->>'text_html' FROM rpc_only_bootstrap),
    'RPC-only question',
    'authorized exam bootstrap still discloses the bounded question normally'
);

SELECT extensions.is(
    (SELECT payload->'questions'->0->'options'->0->>'text_html' FROM rpc_only_bootstrap),
    'Correct option',
    'authorized exam bootstrap still discloses bounded options normally'
);

SELECT * FROM extensions.finish();
ROLLBACK;
