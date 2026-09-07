BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','fast-owner@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'd0000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','fast-other@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9699,'Fast Bootstrap Pathway','test-fast-bootstrap-pathway');

INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9799,9699,'Fast Bootstrap Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('d0000000-0000-0000-0000-000000000001','bank',9799),
('d0000000-0000-0000-0000-000000000002','bank',9799);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(9801,19801,'Fast question 1','SECRET explanation 1','Fast','One','1'),
(9802,19802,'Fast question 2','SECRET explanation 2','Fast','Two','1'),
(9803,19803,'Fast question 3','SECRET explanation 3','Fast','Three','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(9799,9801),(9799,9802),(9799,9803);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(98101,9801,'A1',TRUE,0,80),(98102,9801,'B1',FALSE,1,20),
(98201,9802,'A2',TRUE,0,70),(98202,9802,'B2',FALSE,1,30),
(98301,9803,'A3',TRUE,0,60),(98302,9803,'B3',FALSE,1,40);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE fast_bootstrap(payload jsonb);
INSERT INTO fast_bootstrap
SELECT public.create_exam_session_bootstrap(
    9799,'tutor',2,
    ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT extensions.is(
    (SELECT payload->>'status' FROM fast_bootstrap),
    'active'::text,
    'fast bootstrap creates an active session'
);

SELECT extensions.is(
    (SELECT jsonb_array_length(payload->'question_ids') FROM fast_bootstrap),
    2,
    'fast bootstrap locks exactly the requested number of question ids'
);

SELECT extensions.is(
    (SELECT jsonb_array_length(payload->'questions') FROM fast_bootstrap),
    1,
    'fast bootstrap only ships the current question content'
);

SELECT extensions.ok(
    NOT (SELECT (payload->'questions'->0) ? 'explanation_html' FROM fast_bootstrap),
    'unanswered bootstrap question never exposes explanation_html'
);

SELECT extensions.ok(
    NOT (SELECT (payload->'questions'->0->'options'->0) ? 'is_correct' FROM fast_bootstrap),
    'unanswered bootstrap option never exposes is_correct'
);

SELECT extensions.ok(
    NOT (SELECT (payload->'questions'->0->'options'->0) ? 'percentage' FROM fast_bootstrap),
    'unanswered bootstrap option never exposes percentage'
);

SELECT extensions.is(
    jsonb_array_length(public.get_exam_session_window(
        (SELECT (payload->'session'->>'id')::uuid FROM fast_bootstrap),
        0,
        2
    )),
    2,
    'owner can fetch a small safe question window'
);

CREATE TEMP TABLE foreign_bootstrap_attempt(blocked boolean);
SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000002',true);
DO $$
BEGIN
    BEGIN
        PERFORM public.get_exam_session_bootstrap(
            (SELECT (payload->'session'->>'id')::uuid FROM fast_bootstrap)
        );
        INSERT INTO foreign_bootstrap_attempt VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO foreign_bootstrap_attempt VALUES (TRUE);
    END;
END;
$$;

SELECT extensions.ok(
    (SELECT blocked FROM foreign_bootstrap_attempt LIMIT 1),
    'another authenticated user cannot bootstrap the owner session'
);

CREATE TEMP TABLE oversized_window_attempt(blocked boolean);
SELECT set_config('request.jwt.claim.sub','d0000000-0000-0000-0000-000000000001',true);
DO $$
BEGIN
    BEGIN
        PERFORM public.get_exam_session_window(
            (SELECT (payload->'session'->>'id')::uuid FROM fast_bootstrap),
            0,
            6
        );
        INSERT INTO oversized_window_attempt VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO oversized_window_attempt VALUES (TRUE);
    END;
END;
$$;

SELECT extensions.ok(
    (SELECT blocked FROM oversized_window_attempt LIMIT 1),
    'question windows are capped to five questions'
);

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',true);
SELECT set_config('request.jwt.claim.sub','',true);

CREATE TEMP TABLE anon_bootstrap_attempt(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.get_exam_session_bootstrap(
            (SELECT (payload->'session'->>'id')::uuid FROM fast_bootstrap)
        );
        INSERT INTO anon_bootstrap_attempt VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO anon_bootstrap_attempt VALUES (TRUE);
    END;
END;
$$;

RESET ROLE;
SELECT extensions.ok(
    (SELECT blocked FROM anon_bootstrap_attempt LIMIT 1),
    'anon cannot execute protected exam bootstrap RPCs'
);

SELECT * FROM extensions.finish();
ROLLBACK;
