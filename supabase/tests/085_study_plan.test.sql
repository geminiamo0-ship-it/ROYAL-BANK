BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'c8500000-0000-0000-0000-000000000001',
    'authenticated','authenticated','study-owner@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'c8500000-0000-0000-0000-000000000002',
    'authenticated','authenticated','study-other@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9850,'Study Plan Pathway','test-study-plan-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9851,9850,'Study Plan Bank',FALSE,NULL);
INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('c8500000-0000-0000-0000-000000000001','bank',9851),
('c8500000-0000-0000-0000-000000000002','bank',9851);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(98501,198501,'Q1','E1','Cardiology','Heart Failure','1'),
(98502,198502,'Q2','E2','Cardiology & Vascular','Heart Failure','2'),
(98503,198503,'Q3','E3','Nephrology','Acute Kidney Injury','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(9851,98501),(9851,98502),(9851,98503);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(985011,98501,'A',TRUE,0,50),(985012,98501,'B',FALSE,1,50),
(985021,98502,'A',TRUE,0,50),(985022,98502,'B',FALSE,1,50),
(985031,98503,'A',TRUE,0,50),(985032,98503,'B',FALSE,1,50);

INSERT INTO public.library_articles (id,name,category,topic,content_html,source)
VALUES ('study-hf','Heart Failure Library','Cardiology','Heart Failure','<p>HF article</p>','Royal Library');
INSERT INTO public.question_bank_library_articles (question_bank_id,article_id,display_order)
VALUES (9851,'study-hf',1);

SELECT public.refresh_content_topic_links(9851);

SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.content_topics WHERE question_bank_id=9851),
    2::bigint,
    'same topic name across legacy category variants collapses to one canonical topic'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.question_topics WHERE question_bank_id=9851),
    3::bigint,
    'all bank questions receive a canonical topic link'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.topic_library_articles WHERE question_bank_id=9851 AND article_id='study-hf'),
    1::bigint,
    'library article links to the same canonical topic'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c8500000-0000-0000-0000-000000000001',true);

SELECT extensions.is(
    (public.get_study_plan_catalog(9851)->>'topic_count')::integer,
    2,
    'catalog exposes the two active canonical topics'
);

CREATE TEMP TABLE created_plan(id uuid);
INSERT INTO created_plan
SELECT public.create_study_plan(
    9851,
    DATE '2030-01-01',
    DATE '2030-01-12',
    ARRAY[0,1,2,3,4,5,6]::smallint[],
    'redistribute',
    0.5,
    '[{"start_date":"2030-01-05","end_date":"2030-01-06","mode":"reduced"}]'::jsonb,
    '[{"category":"Cardiology","priority":0},{"category":"Nephrology","priority":1}]'::jsonb
);

SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.study_plan_tasks WHERE plan_id=(SELECT id FROM created_plan)),
    2::bigint,
    'one Study Plan task is created per canonical topic'
);
SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1 FROM public.study_plan_tasks
        WHERE plan_id=(SELECT id FROM created_plan)
          AND (scheduled_date < DATE '2030-01-01' OR scheduled_date >= DATE '2030-01-12')
    ),
    'scheduler keeps every topic inside the plan window'
);

CREATE TEMP TABLE completed_snapshot(task_id bigint, scheduled_date date);
INSERT INTO completed_snapshot
SELECT id, scheduled_date
FROM public.study_plan_tasks
WHERE plan_id=(SELECT id FROM created_plan)
ORDER BY id
LIMIT 1;
SELECT public.mark_study_plan_task_complete((SELECT task_id FROM completed_snapshot));

SELECT public.update_study_plan(
    (SELECT id FROM created_plan),
    DATE '2030-01-01',
    DATE '2030-01-20',
    ARRAY[1,2,3,4,5]::smallint[],
    'next_free_day',
    0.5,
    '[]'::jsonb,
    '[{"category":"Nephrology","priority":0},{"category":"Cardiology","priority":1}]'::jsonb
);

SELECT extensions.is(
    (SELECT scheduled_date FROM public.study_plan_tasks WHERE id=(SELECT task_id FROM completed_snapshot)),
    (SELECT scheduled_date FROM completed_snapshot),
    'editing and rebalancing never moves a completed topic'
);
SELECT extensions.is(
    (SELECT status FROM public.study_plan_tasks WHERE id=(SELECT task_id FROM completed_snapshot)),
    'completed'::text,
    'completed topic remains completed after plan edits'
);

CREATE TEMP TABLE linked_task(task_id bigint);
INSERT INTO linked_task
SELECT id
FROM public.study_plan_tasks
WHERE plan_id=(SELECT id FROM created_plan)
ORDER BY id DESC
LIMIT 1;

CREATE TEMP TABLE study_session(id uuid);
INSERT INTO study_session
SELECT public.create_exam_session(
    'c8500000-0000-0000-0000-000000000001',9851,'tutor',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT public.link_study_plan_session(
    (SELECT task_id FROM linked_task),
    (SELECT id FROM study_session)
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.study_plan_session_links WHERE session_id=(SELECT id FROM study_session)),
    1::bigint,
    'Study Plan links to an owned session in the same bank without creating a new exam engine'
);

SELECT extensions.is(
    ((public.get_study_plan_dashboard(9851)->'plan'->>'total_topics')::integer),
    2,
    'dashboard returns plan progress from topic tasks'
);

SELECT set_config('request.jwt.claim.sub','c8500000-0000-0000-0000-000000000002',true);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.study_plans WHERE id=(SELECT id FROM created_plan)),
    0::bigint,
    'RLS prevents another authenticated user from reading the owner plan'
);
SELECT extensions.is(
    (public.get_study_plan_dashboard(9851)->'plan')::text,
    'null'::text,
    'another entitled user receives no active plan belonging to someone else'
);
SELECT extensions.throws_ok(
    format('SELECT public.mark_study_plan_task_complete(%s)', (SELECT task_id FROM linked_task)),
    'P0001',
    'STUDY_PLAN_TASK_NOT_FOUND',
    'another user cannot mutate the owner plan task'
);

SELECT * FROM extensions.finish();
ROLLBACK;
