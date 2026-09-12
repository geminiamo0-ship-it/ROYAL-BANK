BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000001','authenticated','authenticated','scoped-premium@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','90000000-0000-0000-0000-000000000002','authenticated','authenticated','trial-limit@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways (id,name,slug)
VALUES (9190,'Scoped Premium Pathway','test-scoped-premium-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES (9290,9190,'Scoped Premium Bank',TRUE,5,1);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(9391,19391,'Q1','E1','Medicine','Topic','1'),
(9392,19392,'Q2','E2','Medicine','Topic','1'),
(9393,19393,'Q3','E3','Medicine','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (9290,9391),(9290,9392),(9290,9393);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94911,9391,'A',TRUE,0,50),(94912,9391,'B',FALSE,1,50),
(94921,9392,'A',TRUE,0,50),(94922,9392,'B',FALSE,1,50),
(94931,9393,'A',TRUE,0,50),(94932,9393,'B',FALSE,1,50);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('90000000-0000-0000-0000-000000000001','bank',9290);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',true);
SELECT extensions.ok(public.has_premium_question_bank_access(9290),'bank-scoped grant is canonical premium access');
CREATE TEMP TABLE premium_session(id uuid);
INSERT INTO premium_session
SELECT public.create_exam_session(
    '90000000-0000-0000-0000-000000000001',9290,'standard',3,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_session_questions WHERE test_session_id=(SELECT id FROM premium_session)),
    3::bigint,
    'scoped premium user receives requested questions above trial cap'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.free_trial_block_usage WHERE user_id='90000000-0000-0000-0000-000000000001'),
    0::bigint,
    'premium session does not consume the free-trial ledger'
);

SELECT set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);
CREATE TEMP TABLE trial_session(id uuid);
INSERT INTO trial_session
SELECT public.create_exam_session(
    '90000000-0000-0000-0000-000000000002',9290,'standard',3,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_session_questions WHERE test_session_id=(SELECT id FROM trial_session)),
    1::bigint,
    'trial user remains capped by configured per-block question limit'
);

SELECT * FROM extensions.finish();
ROLLBACK;
