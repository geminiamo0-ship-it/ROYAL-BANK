BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','dashboard-cache@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (10201,'Dashboard Cache Pathway','test-dashboard-cache-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (10301,10201,'Dashboard Cache Bank',FALSE,NULL);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (10401,20401,'Cached question','Cached explanation','Cache Category','Cache Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (10301,10401);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(105011,10401,'Correct',TRUE,0,70),(105012,10401,'Wrong',FALSE,1,30);
INSERT INTO public.user_access_grants (
    id,user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    10601,'d0000000-0000-0000-0000-000000000001','bank',10301,
    now() - interval '1 day', now() + interval '1 day'
);

SELECT extensions.is(
    (SELECT total_questions::bigint
     FROM public.bank_question_stats
     WHERE question_bank_id=10301
       AND category='Cache Category'
       AND topic='Cache Topic'
       AND difficulty='1'),
    1::bigint,
    'static bank stats are precomputed when mappings change'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE first_dashboard(payload jsonb);
INSERT INTO first_dashboard SELECT public.get_question_bank_dashboard(10301);

SELECT extensions.is(
    ((SELECT payload FROM first_dashboard)->0->>'total_questions')::int,
    1,
    'dashboard returns the precomputed total'
);
SELECT extensions.is(
    ((SELECT payload FROM first_dashboard)->0->>'new_count')::int,
    1,
    'untouched question is new'
);

CREATE TEMP TABLE dashboard_session(id uuid);
INSERT INTO dashboard_session
SELECT public.create_exam_session(
    'd0000000-0000-0000-0000-000000000001',10301,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT public.submit_exam_answer((SELECT id FROM dashboard_session),10401,105012,3);

CREATE TEMP TABLE second_dashboard(payload jsonb);
INSERT INTO second_dashboard SELECT public.get_question_bank_dashboard(10301);

SELECT extensions.is(
    ((SELECT payload FROM second_dashboard)->0->>'attempted_count')::int,
    1,
    'answer invalidation refreshes attempted count'
);
SELECT extensions.is(
    ((SELECT payload FROM second_dashboard)->0->>'incorrect_count')::int,
    1,
    'latest finalized incorrect answer is reflected'
);
SELECT extensions.is(
    ((SELECT payload FROM second_dashboard)->0->>'new_count')::int,
    0,
    'answered question is no longer new'
);

SELECT public.set_question_flag(10401,TRUE);
CREATE TEMP TABLE third_dashboard(payload jsonb);
INSERT INTO third_dashboard SELECT public.get_question_bank_dashboard(10301);
SELECT extensions.is(
    ((SELECT payload FROM third_dashboard)->0->>'flagged_count')::int,
    1,
    'flag invalidation refreshes flagged count'
);

SELECT * FROM extensions.finish();
ROLLBACK;
