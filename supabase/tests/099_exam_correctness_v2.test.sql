BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '99000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','exam-v2@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9199,'Exam V2 Pathway','test-exam-v2-pathway');

INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit) VALUES
(92991,9199,'Exam V2 Standard Bank',FALSE,NULL),
(92992,9199,'Exam V2 Timed Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('99000000-0000-0000-0000-000000000001','bank',92991),
('99000000-0000-0000-0000-000000000001','bank',92992);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(93991,193991,'Standard question','Standard explanation','Medicine','V2 standard','1'),
(93992,193992,'Timed question','Timed explanation','Medicine','V2 timed','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(92991,93991),(92992,93992);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(949911,93991,'Correct standard',TRUE,0,70),
(949912,93991,'Wrong standard',FALSE,1,30),
(949921,93992,'Correct timed',TRUE,0,65),
(949922,93992,'Wrong timed',FALSE,1,35);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE standard_session(id uuid);
INSERT INTO standard_session
SELECT public.create_exam_session(
    '99000000-0000-0000-0000-000000000001',92991,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT public.get_exam_session_window((SELECT id FROM standard_session),0,1);

CREATE TEMP TABLE training_feedback(payload jsonb);
INSERT INTO training_feedback
SELECT public.get_exam_training_feedback((SELECT id FROM standard_session),93991);

SELECT extensions.is(
    ((SELECT payload FROM training_feedback)->>'correct_option_id')::bigint,
    949911::bigint,
    'Standard session may prefetch training feedback for a disclosed question'
);

CREATE TEMP TABLE first_submit(payload jsonb);
INSERT INTO first_submit
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000101',
    (SELECT id FROM standard_session),93991,949912,3
);

CREATE TEMP TABLE replay_submit(payload jsonb);
INSERT INTO replay_submit
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000101',
    (SELECT id FROM standard_session),93991,949912,3
);

SELECT extensions.is(
    (SELECT payload::text FROM replay_submit),
    (SELECT payload::text FROM first_submit),
    'Retrying the same answer request returns the stored response'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::integer FROM public.user_answers
     WHERE test_session_id=(SELECT id FROM standard_session) AND question_id=93991),
    1,
    'Idempotent retry creates exactly one answer row'
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE key_reuse(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.submit_exam_answer_idempotent(
            '99000000-0000-0000-0000-000000000101',
            (SELECT id FROM standard_session),93991,949911,4
        );
        INSERT INTO key_reuse VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO key_reuse VALUES (SQLERRM LIKE '%IDEMPOTENCY_KEY_REUSED%');
    END;
END;
$$;
SELECT extensions.ok((SELECT blocked FROM key_reuse),'Reusing an answer idempotency key for different content is rejected');

CREATE TEMP TABLE timed_session(id uuid);
INSERT INTO timed_session
SELECT public.create_exam_session(
    '99000000-0000-0000-0000-000000000001',92992,'fixed_timed',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT public.get_exam_session_window((SELECT id FROM timed_session),0,1);

CREATE TEMP TABLE timed_feedback(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.get_exam_training_feedback((SELECT id FROM timed_session),93992);
        INSERT INTO timed_feedback VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO timed_feedback VALUES (SQLERRM LIKE '%unavailable for this session type%');
    END;
END;
$$;
SELECT extensions.ok((SELECT blocked FROM timed_feedback),'Timed session cannot access pre-answer training feedback');

CREATE TEMP TABLE active_renew(payload jsonb);
INSERT INTO active_renew
SELECT public.renew_exam_window_access((SELECT id FROM standard_session));
SELECT extensions.is(
    jsonb_array_length((SELECT payload FROM active_renew)->'question_ids'),
    1,
    'Window access renewal returns the ordered session question ids without a full bootstrap'
);
SELECT extensions.is(
    ((SELECT payload FROM active_renew)->'session'->>'is_completed')::boolean,
    FALSE,
    'Window access renewal reports an active session as active'
);

SELECT public.complete_exam_session((SELECT id FROM standard_session));
CREATE TEMP TABLE completed_renew(payload jsonb);
INSERT INTO completed_renew
SELECT public.renew_exam_window_access((SELECT id FROM standard_session));
SELECT extensions.is(
    ((SELECT payload FROM completed_renew)->'session'->>'is_completed')::boolean,
    TRUE,
    'Window access renewal preserves completed review capability state'
);

SELECT * FROM extensions.finish();
ROLLBACK;
