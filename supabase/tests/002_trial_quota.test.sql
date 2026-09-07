BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(5);

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','20000000-0000-0000-0000-000000000001','authenticated','authenticated','trial@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways (id,name,slug) VALUES (9110,'Trial Pathway','test-trial-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit)
VALUES (9210,9110,'Trial Bank',TRUE,1,1);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9310,19310,'Trial question','Trial explanation','Medicine','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES (9210,9310);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94101,9310,'Correct',TRUE,0,50),(94102,9310,'Wrong',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE trial_session_id(id uuid);
SELECT extensions.lives_ok($$INSERT INTO trial_session_id SELECT public.create_exam_session('20000000-0000-0000-0000-000000000001',9210,'standard',1,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'new_only')$$,'first trial block is created');
SELECT extensions.is((SELECT count(*)::bigint FROM public.free_trial_block_usage WHERE user_id='20000000-0000-0000-0000-000000000001'),1::bigint,'trial block consumes one ledger entry');

RESET ROLE;
DELETE FROM public.test_sessions WHERE id=(SELECT id FROM trial_session_id);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
SELECT extensions.is((SELECT count(*)::bigint FROM public.free_trial_block_usage WHERE user_id='20000000-0000-0000-0000-000000000001'),1::bigint,'deleting session does not refund trial usage');
SELECT extensions.ok((SELECT test_session_id IS NULL FROM public.free_trial_block_usage WHERE user_id='20000000-0000-0000-0000-000000000001'),'deleted session reference is nulled, ledger is retained');
SELECT extensions.throws_ok($$SELECT public.create_exam_session('20000000-0000-0000-0000-000000000001',9210,'standard',1,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'new_only')$$,'Free-trial block quota exhausted','second block remains blocked after deletion');

SELECT * FROM extensions.finish();
ROLLBACK;
