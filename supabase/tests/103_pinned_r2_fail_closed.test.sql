BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '99400000-0000-0000-0000-000000000001',
    'authenticated','authenticated','pinned-r2-fail-closed@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9195,'Pinned R2 Fail Closed Pathway','test-pinned-r2-fail-closed-pathway');

INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit) VALUES
(92591,9195,'Pinned R2 Bank',FALSE,NULL),
(92592,9195,'Legacy R2 Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('99400000-0000-0000-0000-000000000001','bank',92591),
('99400000-0000-0000-0000-000000000001','bank',92592);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(93591,193591,'Pinned question','Pinned explanation','Medicine','Pinned fail closed','1'),
(93592,193592,'Legacy question','Legacy explanation','Medicine','Legacy fallback','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(92591,93591),(92592,93592);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(945911,93591,'Pinned correct',TRUE,0,75),
(945912,93591,'Pinned wrong',FALSE,1,25),
(945921,93592,'Legacy correct',TRUE,0,65),
(945922,93592,'Legacy wrong',FALSE,1,35);

INSERT INTO private.exam_content_releases(
    release_id,manifest_sha256,question_count,option_count,is_ready,finalized_at
) VALUES (
    repeat('f',64),repeat('6',64),1,2,TRUE,clock_timestamp()
);

INSERT INTO private.exam_content_release_answers(
    release_id,question_id,correct_option_id,option_ids,option_percentages
) VALUES (
    repeat('f',64),93591,945911,ARRAY[945911,945912],'{"945911":75,"945912":25}'::jsonb
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99400000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE pinned_create(payload jsonb);
INSERT INTO pinned_create
SELECT public.create_exam_session_bootstrap_idempotent_v3(
    '99400000-0000-0000-0000-000000000101',
    92591,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all',repeat('f',64)
);

CREATE TEMP TABLE pinned_session(id uuid);
INSERT INTO pinned_session
SELECT ((SELECT payload FROM pinned_create)->'session'->>'id')::uuid;

CREATE TEMP TABLE blocked_window(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_exam_session_window((SELECT id FROM pinned_session),0,1);
        INSERT INTO blocked_window VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_window VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_window),'Pinned active full-content window fails closed without R2 hydration');

CREATE TEMP TABLE blocked_bootstrap(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_exam_session_bootstrap_v3((SELECT id FROM pinned_session),NULL);
        INSERT INTO blocked_bootstrap VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_bootstrap VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_bootstrap),'Pinned full bootstrap fails closed without R2 hydration');

CREATE TEMP TABLE blocked_training(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_exam_training_feedback((SELECT id FROM pinned_session),93591);
        INSERT INTO blocked_training VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_training VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_training),'Pinned full training feedback never falls back to mutable live content');

CREATE TEMP TABLE pinned_submit(payload jsonb);
INSERT INTO pinned_submit
SELECT public.submit_exam_answer_with_feedback_idempotent(
    '99400000-0000-0000-0000-000000000102',
    (SELECT id FROM pinned_session),93591,945911,4
);
SELECT extensions.ok(
    ((SELECT payload FROM pinned_submit)->'answer'->>'is_correct')::boolean
    AND (SELECT payload FROM pinned_submit)->'feedback' = 'null'::jsonb
    AND ((SELECT payload FROM pinned_submit)->>'feedback_pending')::boolean,
    'Pinned answer mutation remains durable and snapshot-correct while feedback stays pending'
);

CREATE TEMP TABLE blocked_feedback(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_exam_question_feedback((SELECT id FROM pinned_session),93591);
        INSERT INTO blocked_feedback VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_feedback VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_feedback),'Pinned answered feedback cannot expose the live answer key');

SELECT public.complete_exam_session((SELECT id FROM pinned_session));

CREATE TEMP TABLE blocked_review_window(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_completed_exam_review_window((SELECT id FROM pinned_session),0,1);
        INSERT INTO blocked_review_window VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_review_window VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_review_window),'Pinned review window fails closed without R2 content');

CREATE TEMP TABLE blocked_review_bootstrap(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_completed_exam_review_bootstrap((SELECT id FROM pinned_session));
        INSERT INTO blocked_review_bootstrap VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_review_bootstrap VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_review_bootstrap),'Pinned review bootstrap fails closed without R2 content');

CREATE TEMP TABLE blocked_review_feedback(blocked boolean);
DO $$ BEGIN
    BEGIN
        PERFORM public.get_completed_exam_review_feedback((SELECT id FROM pinned_session),93591);
        INSERT INTO blocked_review_feedback VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO blocked_review_feedback VALUES (SQLERRM LIKE '%PINNED_CONTENT_REQUIRES_R2%');
    END;
END $$;
SELECT extensions.ok((SELECT blocked FROM blocked_review_feedback),'Pinned completed feedback never falls back to mutable live content');

-- Explicit legacy sessions keep the rollout fallback path available.
CREATE TEMP TABLE legacy_create(payload jsonb);
INSERT INTO legacy_create
SELECT public.create_exam_session_bootstrap_idempotent_v3(
    '99400000-0000-0000-0000-000000000201',
    92592,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all',NULL
);
CREATE TEMP TABLE legacy_session(id uuid);
INSERT INTO legacy_session
SELECT ((SELECT payload FROM legacy_create)->'session'->>'id')::uuid;

CREATE TEMP TABLE legacy_window(payload jsonb);
INSERT INTO legacy_window
SELECT public.get_exam_session_window((SELECT id FROM legacy_session),0,1);
SELECT extensions.is(
    jsonb_array_length((SELECT payload FROM legacy_window)),
    1,
    'Explicit legacy session retains the authenticated live-content rollout fallback'
);

SELECT * FROM extensions.finish();
ROLLBACK;