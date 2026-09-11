BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(21);

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
(92992,9199,'Exam V2 Timed Bank',FALSE,NULL),
(92993,9199,'Exam V2 Tutor Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('99000000-0000-0000-0000-000000000001','bank',92991),
('99000000-0000-0000-0000-000000000001','bank',92992),
('99000000-0000-0000-0000-000000000001','bank',92993);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(93991,193991,'Standard question','Standard explanation','Medicine','V2 standard','1'),
(93992,193992,'Timed question','Timed explanation','Medicine','V2 timed','1'),
(93993,193993,'Tutor question','Tutor explanation','Medicine','V2 tutor','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(92991,93991),(92992,93992),(92993,93993);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(949911,93991,'Correct standard',TRUE,0,70),
(949912,93991,'Wrong standard',FALSE,1,30),
(949921,93992,'Correct timed',TRUE,0,65),
(949922,93992,'Wrong timed',FALSE,1,35),
(949931,93993,'Correct tutor',TRUE,0,60),
(949932,93993,'Wrong tutor',FALSE,1,40);

-- Two immutable content generations. Release B intentionally changes the Standard
-- answer key so the tests can prove a session pinned to A never drifts to B/live data.
INSERT INTO private.exam_content_releases(
    release_id,manifest_sha256,question_count,option_count,is_ready,finalized_at
) VALUES
(repeat('a',64),repeat('1',64),3,6,TRUE,clock_timestamp()),
(repeat('b',64),repeat('2',64),3,6,TRUE,clock_timestamp());

INSERT INTO private.exam_content_release_answers(
    release_id,question_id,correct_option_id,option_ids,option_percentages
) VALUES
(repeat('a',64),93991,949911,ARRAY[949911,949912],'{"949911":70,"949912":30}'::jsonb),
(repeat('a',64),93992,949921,ARRAY[949921,949922],'{"949921":65,"949922":35}'::jsonb),
(repeat('a',64),93993,949931,ARRAY[949931,949932],'{"949931":60,"949932":40}'::jsonb),
(repeat('b',64),93991,949912,ARRAY[949911,949912],'{"949911":40,"949912":60}'::jsonb),
(repeat('b',64),93992,949921,ARRAY[949921,949922],'{"949921":65,"949922":35}'::jsonb),
(repeat('b',64),93993,949931,ARRAY[949931,949932],'{"949931":60,"949932":40}'::jsonb);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE standard_create_v3(payload jsonb);
INSERT INTO standard_create_v3
SELECT public.create_exam_session_bootstrap_idempotent_v3(
    '99000000-0000-0000-0000-000000000100',
    92991,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all',repeat('a',64)
);

CREATE TEMP TABLE standard_session(id uuid);
INSERT INTO standard_session
SELECT ((SELECT payload FROM standard_create_v3)->'session'->>'id')::uuid;

SELECT extensions.is(
    (SELECT payload FROM standard_create_v3)->'session'->>'content_release_id',
    repeat('a',64),
    'Standard v3 create pins the requested ready content release'
);

CREATE TEMP TABLE standard_create_replay_v3(payload jsonb);
INSERT INTO standard_create_replay_v3
SELECT public.create_exam_session_bootstrap_idempotent_v3(
    '99000000-0000-0000-0000-000000000100',
    92991,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all',repeat('b',64)
);
SELECT extensions.is(
    (SELECT payload FROM standard_create_replay_v3)->'session'->>'content_release_id',
    repeat('a',64),
    'Idempotent create replay preserves the original session release after active release changes'
);

CREATE TEMP TABLE standard_bootstrap_v2(payload jsonb);
INSERT INTO standard_bootstrap_v2
SELECT public.get_exam_session_bootstrap_v2((SELECT id FROM standard_session));
SELECT extensions.ok(
    (SELECT payload IS NOT NULL FROM standard_bootstrap_v2),
    'Standard v2 bootstrap returns a payload instead of SQL NULL'
);
SELECT extensions.is(
    jsonb_typeof((SELECT payload FROM standard_bootstrap_v2)->'session'->'deadline_at'),
    'null',
    'Standard v2 bootstrap encodes deadline_at as JSON null'
);

CREATE TEMP TABLE standard_bootstrap_ref_v2(payload jsonb);
INSERT INTO standard_bootstrap_ref_v2
SELECT public.get_exam_session_bootstrap_ref_v2((SELECT id FROM standard_session));
SELECT extensions.ok(
    (SELECT payload IS NOT NULL FROM standard_bootstrap_ref_v2),
    'Standard v2 ref bootstrap also returns a payload'
);

CREATE TEMP TABLE tutor_bootstrap_v2(payload jsonb);
INSERT INTO tutor_bootstrap_v2
SELECT public.create_exam_session_bootstrap_idempotent_v2(
    '99000000-0000-0000-0000-000000000201',
    92993,'tutor',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);
SELECT extensions.ok(
    (SELECT payload IS NOT NULL FROM tutor_bootstrap_v2),
    'Tutor create v2 returns a payload instead of SQL NULL'
);
SELECT extensions.is(
    jsonb_typeof((SELECT payload FROM tutor_bootstrap_v2)->'session'->'deadline_at'),
    'null',
    'Tutor create v2 encodes deadline_at as JSON null'
);

CREATE TEMP TABLE tutor_session(id uuid);
INSERT INTO tutor_session
SELECT ((SELECT payload FROM tutor_bootstrap_v2)->'session'->>'id')::uuid;

CREATE TEMP TABLE training_feedback(payload jsonb);
INSERT INTO training_feedback
SELECT public.get_exam_training_feedback((SELECT id FROM standard_session),93991);
SELECT extensions.is(
    ((SELECT payload FROM training_feedback)->>'correct_option_id')::bigint,
    949911::bigint,
    'Standard session may prefetch training feedback for a disclosed question'
);

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
SELECT extensions.is(
    (SELECT payload FROM active_renew)->>'content_release_id',
    repeat('a',64),
    'Window access renewal keeps the exact content release pinned to the session'
);

-- Simulate a live content edit after the session has already pinned release A.
RESET ROLE;
UPDATE public.options SET is_correct=FALSE WHERE id=949911;
UPDATE public.options SET is_correct=TRUE WHERE id=949912;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE first_submit(payload jsonb);
INSERT INTO first_submit
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000101',
    (SELECT id FROM standard_session),93991,949911,3
);
SELECT extensions.is(
    ((SELECT payload FROM first_submit)->>'is_correct')::boolean,
    TRUE,
    'Pinned Standard scoring uses release A even after the live answer key changes'
);

CREATE TEMP TABLE replay_submit(payload jsonb);
INSERT INTO replay_submit
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000101',
    (SELECT id FROM standard_session),93991,949911,3
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
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE key_reuse(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.submit_exam_answer_idempotent(
            '99000000-0000-0000-0000-000000000101',
            (SELECT id FROM standard_session),93991,949912,4
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

RESET ROLE;
UPDATE public.test_sessions
SET time_limit_minutes=1, started_at=clock_timestamp()
WHERE id=(SELECT id FROM timed_session);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE timed_before_deadline(payload jsonb);
INSERT INTO timed_before_deadline
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000301',
    (SELECT id FROM timed_session),93992,949921,5
);
SELECT extensions.is(
    ((SELECT payload FROM timed_before_deadline)->>'selected_option_id')::bigint,
    949921::bigint,
    'Timed answer received before the authoritative deadline is accepted'
);

RESET ROLE;
UPDATE public.test_sessions
SET started_at=clock_timestamp()-interval '2 minutes', time_limit_minutes=1
WHERE id=(SELECT id FROM timed_session);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE timed_replay_after_deadline(payload jsonb);
INSERT INTO timed_replay_after_deadline
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000301',
    (SELECT id FROM timed_session),93992,949921,5
);
SELECT extensions.is(
    (SELECT payload::text FROM timed_replay_after_deadline),
    (SELECT payload::text FROM timed_before_deadline),
    'ACK replay for a request committed before deadline still succeeds after deadline'
);

CREATE TEMP TABLE timed_late_submit(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.submit_exam_answer_idempotent(
            '99000000-0000-0000-0000-000000000302',
            (SELECT id FROM timed_session),93992,949922,6
        );
        INSERT INTO timed_late_submit VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO timed_late_submit VALUES (SQLERRM LIKE '%EXAM_DEADLINE_EXPIRED%');
    END;
END;
$$;
SELECT extensions.ok(
    (SELECT blocked FROM timed_late_submit),
    'New timed answer request received after the authoritative deadline is rejected'
);

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

-- Non-timed modes never use the timed deadline rule even if old timing metadata exists.
RESET ROLE;
UPDATE public.test_sessions
SET started_at=clock_timestamp()-interval '2 hours', time_limit_minutes=1
WHERE id=(SELECT id FROM tutor_session);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE tutor_old_clock_submit(payload jsonb);
INSERT INTO tutor_old_clock_submit
SELECT public.submit_exam_answer_idempotent(
    '99000000-0000-0000-0000-000000000401',
    (SELECT id FROM tutor_session),93993,949931,7
);
SELECT extensions.is(
    ((SELECT payload FROM tutor_old_clock_submit)->>'selected_option_id')::bigint,
    949931::bigint,
    'Tutor answer is unaffected by timed deadline enforcement'
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
