BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','50000000-0000-0000-0000-000000000001','authenticated','authenticated','delete@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways (id,name,slug) VALUES (9150,'Delete Pathway','test-delete-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9250,9150,'Delete Bank',FALSE,NULL);
INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('50000000-0000-0000-0000-000000000001','bank',9250);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(9351,19351,'Delete Q1','E1','Medicine','Topic','1'),
(9352,19352,'Delete Q2','E2','Medicine','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES (9250,9351),(9250,9352);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94511,9351,'Q1 correct',TRUE,0,50),(94512,9351,'Q1 wrong',FALSE,1,50),
(94521,9352,'Q2 correct',TRUE,0,50),(94522,9352,'Q2 wrong',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','50000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE delete_session(id uuid);
INSERT INTO delete_session
SELECT public.create_exam_session(
    '50000000-0000-0000-0000-000000000001',9250,'standard',2,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT public.get_exam_session_window((SELECT id FROM delete_session),0,2);
SELECT public.submit_exam_answer((SELECT id FROM delete_session),9351,94511,4);
SELECT extensions.is((SELECT count(*)::bigint FROM public.user_answers WHERE test_session_id=(SELECT id FROM delete_session)),1::bigint,'one answer exists before deletion');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9250) WHERE answer_state='correct'),1::bigint,'answered question is Correct before deletion');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9250) WHERE is_suspended),1::bigint,'unanswered locked question is Suspended before deletion');

DELETE FROM public.test_sessions WHERE id=(SELECT id FROM delete_session);

SELECT extensions.is((SELECT count(*)::bigint FROM public.test_sessions WHERE id=(SELECT id FROM delete_session)),0::bigint,'session row is deleted');
SELECT extensions.is((SELECT count(*)::bigint FROM public.user_answers WHERE user_id='50000000-0000-0000-0000-000000000001' AND question_id IN (9351,9352)),0::bigint,'session answers are deleted with the session');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9250) WHERE is_suspended),0::bigint,'no questions remain Suspended after deletion');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9250) WHERE is_new),2::bigint,'all questions from deleted session return to New');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9250) WHERE answer_state IS NOT NULL),0::bigint,'deleted session leaves no Correct or Incorrect state');

SELECT * FROM extensions.finish();
ROLLBACK;