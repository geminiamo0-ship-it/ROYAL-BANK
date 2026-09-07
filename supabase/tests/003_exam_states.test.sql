BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','30000000-0000-0000-0000-000000000001','authenticated','authenticated','exam@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
INSERT INTO public.pathways (id,name,slug) VALUES (9120,'Exam Pathway','test-exam-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit) VALUES (9220,9120,'Exam Bank',FALSE,NULL);
INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES ('30000000-0000-0000-0000-000000000001','bank',9220);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(9321,19321,'Q1','E1','Medicine','Topic','1'),(9322,19322,'Q2','E2','Medicine','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES (9220,9321),(9220,9322);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94211,9321,'Q1 correct',TRUE,0,50),(94212,9321,'Q1 wrong',FALSE,1,50),
(94221,9322,'Q2 correct',TRUE,0,50),(94222,9322,'Q2 wrong',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);

SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9220) WHERE is_new),2::bigint,'both questions start New');
CREATE TEMP TABLE exam_session(id uuid);
INSERT INTO exam_session SELECT public.create_exam_session('30000000-0000-0000-0000-000000000001',9220,'timed',2,ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9220) WHERE is_suspended),2::bigint,'locked unanswered questions are Suspended');

-- The answer APIs now require the content to have passed the guarded disclosure path.
SELECT public.get_exam_session_window((SELECT id FROM exam_session),0,2);

-- Timed mode must update the same answer row until End Block.
SELECT public.submit_exam_answer((SELECT id FROM exam_session),9321,94212,3);
SELECT public.submit_exam_answer((SELECT id FROM exam_session),9321,94211,5);

-- Direct answer-table SELECT is intentionally unavailable to authenticated users.
-- Switch back to the test owner only for internal persistence assertions.
RESET ROLE;
SELECT extensions.is((SELECT count(*)::bigint FROM public.user_answers WHERE test_session_id=(SELECT id FROM exam_session) AND question_id=9321),1::bigint,'timed edits keep one answer row');
SELECT extensions.is((SELECT selected_option_id FROM public.user_answers WHERE test_session_id=(SELECT id FROM exam_session) AND question_id=9321),94211::bigint,'latest timed option wins');
SELECT extensions.ok((SELECT is_correct FROM public.user_answers WHERE test_session_id=(SELECT id FROM exam_session) AND question_id=9321),'correctness is derived from latest option');
SET LOCAL ROLE authenticated;

SELECT public.set_question_flag(9321,TRUE);
SELECT extensions.ok((SELECT is_flagged FROM public.get_user_question_states(9220) WHERE question_id=9321),'flag is persistent and independent');
SELECT extensions.is((SELECT count(*)::bigint FROM public.get_user_question_states(9220) WHERE is_suspended),1::bigint,'answering one question leaves only the unanswered question Suspended');

SELECT public.complete_exam_session((SELECT id FROM exam_session));

RESET ROLE;
SELECT extensions.ok((SELECT is_completed FROM public.test_sessions WHERE id=(SELECT id FROM exam_session)),'End Block completes the session');
SELECT extensions.ok((SELECT selected_option_id IS NULL AND is_correct=FALSE FROM public.user_answers WHERE test_session_id=(SELECT id FROM exam_session) AND question_id=9322),'timed unanswered question is finalized Incorrect');

SELECT * FROM extensions.finish();
ROLLBACK;