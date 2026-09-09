BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'e0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','live-performance@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (11201,'Live Performance Pathway','test-live-performance-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (11301,11201,'Live Performance Bank',FALSE,NULL);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(11401,21401,'Easy question','Explanation','Cardiology','Rhythm','1'),
(11402,21402,'Hard question','Explanation','Cardiology','Rhythm','3'),
(11403,21403,'Other question','Explanation','Neurology','Stroke','2');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(11301,11401),(11301,11402),(11301,11403);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(115011,11401,'Correct',TRUE,0,80),(115012,11401,'Wrong',FALSE,1,20),
(115021,11402,'Correct',TRUE,0,30),(115022,11402,'Wrong',FALSE,1,70),
(115031,11403,'Correct',TRUE,0,60),(115032,11403,'Wrong',FALSE,1,40);

INSERT INTO public.user_access_grants (
    id,user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    11601,'e0000000-0000-0000-0000-000000000001','bank',11301,
    now() - interval '1 day', now() + interval '1 day'
);

SELECT extensions.throws_ok(
    $$SELECT public.get_question_bank_performance(11301)$$,
    'Authentication required',
    'performance RPC requires authentication'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE perf_session(id uuid);
INSERT INTO perf_session
SELECT public.create_exam_session(
    'e0000000-0000-0000-0000-000000000001',
    11301,
    'standard',
    2,
    ARRAY['1','3']::text[],
    ARRAY['Cardiology']::text[],
    '[]'::jsonb,
    'all'
);

SELECT public.get_exam_session_window((SELECT id FROM perf_session),0,2);
SELECT public.submit_exam_answer((SELECT id FROM perf_session),11401,115011,30);
SELECT public.submit_exam_answer((SELECT id FROM perf_session),11402,115022,45);

CREATE TEMP TABLE perf(payload jsonb);
INSERT INTO perf SELECT public.get_question_bank_performance(11301);

SELECT extensions.is(((SELECT payload FROM perf)->>'total_questions')::int,3,'total question count is live');
SELECT extensions.is(((SELECT payload FROM perf)->>'answered')::int,2,'answered count is live');
SELECT extensions.is(((SELECT payload FROM perf)->>'correct')::int,1,'correct count is live');
SELECT extensions.is(((SELECT payload FROM perf)->>'incorrect')::int,1,'incorrect count is live');
SELECT extensions.ok(((SELECT payload FROM perf)->>'peer_average')::numeric BETWEEN 30 AND 80,'peer benchmark comes from option percentages');
SELECT extensions.ok(((SELECT payload FROM perf)->>'estimated_percentile')::numeric BETWEEN 1 AND 99,'estimated percentile is bounded');
SELECT extensions.is(jsonb_array_length((SELECT payload FROM perf)->'categories'),1,'only answered category appears in performance comparison');
SELECT extensions.ok(jsonb_array_length((SELECT payload FROM perf)->'activity') >= 1,'activity heatmap uses persisted answer dates');
SELECT extensions.is((SELECT answered_count FROM public.get_my_bank_sessions(11301,100) LIMIT 1),2::bigint,'session history returns persisted answer count');

SELECT * FROM extensions.finish();
ROLLBACK;