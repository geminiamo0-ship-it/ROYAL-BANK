BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','completed-review@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (12201,'Completed Review Pathway','test-completed-review-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (12301,12201,'Completed Review Bank',FALSE,NULL);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (12401,22401,'Review question','Review explanation','Review Category','Review Topic','3');
INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (12301,12401);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(125011,12401,'Correct',TRUE,0,35),
(125012,12401,'Wrong',FALSE,1,65);
INSERT INTO public.user_access_grants (
    id,user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    12601,'f0000000-0000-0000-0000-000000000001','bank',12301,
    now() - interval '1 day', now() + interval '1 day'
);

SELECT extensions.throws_ok(
    $$SELECT public.get_completed_exam_review_bootstrap('f1000000-0000-0000-0000-000000000001'::uuid)$$,
    'Active authentication required',
    'completed review requires authentication'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE review_session(id uuid);
INSERT INTO review_session
SELECT public.create_exam_session(
    'f0000000-0000-0000-0000-000000000001',
    12301,
    'standard',
    1,
    ARRAY['3']::text[],
    ARRAY[]::text[],
    '[]'::jsonb,
    'all'
);

SELECT public.get_exam_session_window((SELECT id FROM review_session),0,1);
SELECT public.submit_exam_answer((SELECT id FROM review_session),12401,125012,21);

SELECT extensions.throws_ok(
    format('SELECT public.get_completed_exam_review_bootstrap(%L::uuid)',(SELECT id::text FROM review_session)),
    'Session is not completed',
    'review bootstrap rejects unfinished session'
);

SELECT public.complete_exam_session((SELECT id FROM review_session));

CREATE TEMP TABLE review_bootstrap(payload jsonb);
INSERT INTO review_bootstrap
SELECT public.get_completed_exam_review_bootstrap((SELECT id FROM review_session));

SELECT extensions.is((SELECT payload->>'status' FROM review_bootstrap),'completed','review bootstrap is completed');
SELECT extensions.is(jsonb_array_length((SELECT payload->'question_ids' FROM review_bootstrap)),1,'review bootstrap returns owned session question ids');
SELECT extensions.is(jsonb_array_length((SELECT payload->'questions' FROM review_bootstrap)),1,'review bootstrap includes the first question');
SELECT extensions.is(jsonb_array_length(public.get_completed_exam_review_window((SELECT id FROM review_session),0,1)),1,'review window reads completed session question');
SELECT extensions.is((public.get_completed_exam_review_feedback((SELECT id FROM review_session),12401)->>'correct_option_id')::bigint,125011::bigint,'review feedback reveals correct option after completion');
SELECT extensions.is((public.get_completed_exam_review_feedback((SELECT id FROM review_session),12401)->'option_percentages'->>'125011')::numeric,35::numeric,'review feedback uses real option percentage');

SELECT * FROM extensions.finish();
ROLLBACK;