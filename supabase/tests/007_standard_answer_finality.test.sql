BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','70000000-0000-0000-0000-000000000001','authenticated','authenticated','standard@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways (id,name,slug) VALUES (9170,'Standard Pathway','test-standard-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9270,9170,'Standard Bank',FALSE,NULL);
INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('70000000-0000-0000-0000-000000000001','bank',9270);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9370,19370,'Standard Q','E','Medicine','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES (9270,9370);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94701,9370,'Correct',TRUE,0,50),(94702,9370,'Wrong',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','70000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE standard_session(id uuid);
INSERT INTO standard_session
SELECT public.create_exam_session(
    '70000000-0000-0000-0000-000000000001',9270,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT public.get_exam_session_window((SELECT id FROM standard_session),0,1);
SELECT public.submit_exam_answer((SELECT id FROM standard_session),9370,94702,3);

RESET ROLE;
SELECT extensions.is((SELECT selected_option_id FROM public.user_answers WHERE test_session_id=(SELECT id FROM standard_session) AND question_id=9370),94702::bigint,'first Standard submission is stored');
SELECT extensions.ok(NOT (SELECT is_correct FROM public.user_answers WHERE test_session_id=(SELECT id FROM standard_session) AND question_id=9370),'server derives first Standard answer as incorrect');
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE second_submit(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.submit_exam_answer((SELECT id FROM standard_session),9370,94701,4);
        INSERT INTO second_submit VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO second_submit VALUES (TRUE);
    END;
END;
$$;

SELECT extensions.ok((SELECT blocked FROM second_submit),'second Standard submission is rejected');

RESET ROLE;
SELECT extensions.is((SELECT selected_option_id FROM public.user_answers WHERE test_session_id=(SELECT id FROM standard_session) AND question_id=9370),94702::bigint,'rejected resubmission cannot change the stored answer');

SELECT * FROM extensions.finish();
ROLLBACK;