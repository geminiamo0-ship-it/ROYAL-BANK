BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(19);

SELECT extensions.ok(
    NOT has_column_privilege('authenticated', 'public.options', 'is_correct', 'SELECT'),
    'authenticated cannot select option correctness directly'
);
SELECT extensions.ok(
    NOT has_column_privilege('authenticated', 'public.options', 'percentage', 'SELECT'),
    'authenticated cannot select option percentages before feedback'
);
SELECT extensions.ok(
    has_column_privilege('authenticated', 'public.options', 'text_html', 'SELECT'),
    'authenticated can select safe option text'
);
SELECT extensions.ok(
    NOT has_column_privilege('authenticated', 'public.questions', 'explanation_html', 'SELECT'),
    'authenticated cannot select explanation directly'
);
SELECT extensions.ok(
    has_column_privilege('authenticated', 'public.questions', 'text_html', 'SELECT'),
    'authenticated can select safe question stem'
);
SELECT extensions.ok(
    has_column_privilege('authenticated', 'public.questions', 'notes_id', 'SELECT'),
    'authenticated can select safe textbook metadata'
);
SELECT extensions.ok(
    has_column_privilege('authenticated', 'public.questions', 'concept_id', 'SELECT'),
    'authenticated can select safe concept metadata'
);
SELECT extensions.ok(
    NOT has_column_privilege('authenticated', 'public.user_answers', 'is_correct', 'SELECT'),
    'authenticated cannot select stored correctness directly'
);

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
VALUES ('00000000-0000-0000-0000-000000000000','80000000-0000-0000-0000-000000000001','authenticated','authenticated','feedback@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways (id,name,slug) VALUES (9180,'Feedback Pathway','test-feedback-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9280,9180,'Feedback Bank',FALSE,NULL);
INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('80000000-0000-0000-0000-000000000001','bank',9280);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(9381,19381,'Timed secure question','Timed secure explanation','TimedSecurity','Topic','1'),
(9382,19382,'Standard secure question','Standard secure explanation','StandardSecurity','Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES (9280,9381),(9280,9382);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94811,9381,'Timed correct',TRUE,0,80),(94812,9381,'Timed wrong',FALSE,1,20),
(94821,9382,'Standard correct',TRUE,0,70),(94822,9382,'Standard wrong',FALSE,1,30);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE secure_timed_session(id uuid);
INSERT INTO secure_timed_session
SELECT public.create_exam_session(
    '80000000-0000-0000-0000-000000000001',9280,'timed',1,
    ARRAY[]::text[],ARRAY['TimedSecurity']::text[],'[]'::jsonb,'all'
);

CREATE TEMP TABLE timed_submit(payload jsonb);
INSERT INTO timed_submit
SELECT public.submit_exam_answer((SELECT id FROM secure_timed_session),9381,94811,5);

SELECT extensions.ok(
    (SELECT payload->>'is_correct' IS NULL FROM timed_submit),
    'active Timed submit result masks correctness'
);
SELECT extensions.ok(
    (SELECT is_correct IS NULL FROM public.get_exam_session_answers((SELECT id FROM secure_timed_session)) WHERE question_id=9381),
    'active Timed resume payload masks correctness'
);
SELECT extensions.ok(
    (SELECT answer_state IS NULL FROM public.get_user_question_states(9280) WHERE question_id=9381),
    'active Timed answer is not exposed as finalized Correct/Incorrect'
);
SELECT extensions.ok(
    (SELECT NOT is_new FROM public.get_user_question_states(9280) WHERE question_id=9381),
    'answered question locked in active Timed session is not New'
);
SELECT extensions.ok(
    (SELECT NOT is_suspended FROM public.get_user_question_states(9280) WHERE question_id=9381),
    'answered Timed question is not mislabeled Suspended'
);

CREATE TEMP TABLE active_feedback_attempt(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.get_exam_question_feedback((SELECT id FROM secure_timed_session),9381);
        INSERT INTO active_feedback_attempt VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO active_feedback_attempt VALUES (TRUE);
    END;
END;
$$;
SELECT extensions.ok((SELECT blocked FROM active_feedback_attempt),'active Timed feedback is blocked');

SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.get_user_category_analytics('80000000-0000-0000-0000-000000000001') WHERE category='TimedSecurity'),
    0::bigint,
    'analytics excludes active mutable Timed correctness'
);

SELECT public.complete_exam_session((SELECT id FROM secure_timed_session));
SELECT extensions.is(
    (SELECT answer_state FROM public.get_user_question_states(9280) WHERE question_id=9381),
    'correct'::text,
    'Timed answer becomes finalized after End Block'
);
SELECT extensions.ok(
    (SELECT (public.get_exam_question_feedback((SELECT id FROM secure_timed_session),9381)->>'is_correct')::boolean),
    'Timed feedback is available after End Block'
);

CREATE TEMP TABLE secure_standard_session(id uuid);
INSERT INTO secure_standard_session
SELECT public.create_exam_session(
    '80000000-0000-0000-0000-000000000001',9280,'standard',1,
    ARRAY[]::text[],ARRAY['StandardSecurity']::text[],'[]'::jsonb,'all'
);

CREATE TEMP TABLE standard_submit(payload jsonb);
INSERT INTO standard_submit
SELECT public.submit_exam_answer((SELECT id FROM secure_standard_session),9382,94822,4);
SELECT extensions.ok(
    NOT (SELECT (payload->>'is_correct')::boolean FROM standard_submit),
    'Standard final submit may reveal submitted correctness immediately'
);
SELECT extensions.is(
    (SELECT (public.get_exam_question_feedback((SELECT id FROM secure_standard_session),9382)->>'correct_option_id')::bigint),
    94821::bigint,
    'Standard feedback exposes the correct option only after final submit'
);

SELECT * FROM extensions.finish();
ROLLBACK;
