BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','delete-policy@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9195,'Delete Policy Pathway','test-delete-policy-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9295,9195,'Delete Policy Bank',FALSE,NULL);
INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('a0000000-0000-0000-0000-000000000001','bank',9295);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9395,19395,'Delete policy Q','E','Medicine','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES (9295,9395);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94951,9395,'A',TRUE,0,50),(94952,9395,'B',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE completed_session(id uuid);
INSERT INTO completed_session
SELECT public.create_exam_session(
    'a0000000-0000-0000-0000-000000000001',9295,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT public.complete_exam_session((SELECT id FROM completed_session));
SELECT extensions.ok(
    (SELECT is_completed FROM public.test_sessions WHERE id=(SELECT id FROM completed_session)),
    'fixture session is completed'
);

DELETE FROM public.test_sessions WHERE id=(SELECT id FROM completed_session);
SELECT extensions.ok(
    EXISTS (SELECT 1 FROM public.test_sessions WHERE id=(SELECT id FROM completed_session)),
    'completed session cannot be deleted by its owner'
);

CREATE TEMP TABLE incomplete_session(id uuid);
INSERT INTO incomplete_session
SELECT public.create_exam_session(
    'a0000000-0000-0000-0000-000000000001',9295,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

RESET ROLE;
DELETE FROM public.user_access_grants
WHERE user_id='a0000000-0000-0000-0000-000000000001'
  AND question_bank_id=9295;
SET LOCAL ROLE authenticated;
SELECT extensions.ok(
    NOT public.can_access_question_bank(9295),
    'fixture user no longer has bank access'
);

DELETE FROM public.test_sessions WHERE id=(SELECT id FROM incomplete_session);
SELECT extensions.ok(
    NOT EXISTS (SELECT 1 FROM public.test_sessions WHERE id=(SELECT id FROM incomplete_session)),
    'owner can delete an incomplete session even after bank access expires'
);

SELECT * FROM extensions.finish();
ROLLBACK;
