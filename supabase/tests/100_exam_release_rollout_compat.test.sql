BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(3);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '99100000-0000-0000-0000-000000000001',
    'authenticated','authenticated','legacy-release@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9198,'Legacy Release Pathway','test-legacy-release-pathway');

INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (92891,9198,'Legacy Release Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('99100000-0000-0000-0000-000000000001','bank',92891);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (93891,193891,'Legacy question','Legacy explanation','Medicine','Legacy release','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (92891,93891);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(948911,93891,'Correct legacy',TRUE,0,75),
(948912,93891,'Wrong legacy',FALSE,1,25);

INSERT INTO private.exam_content_releases(
    release_id,manifest_sha256,question_count,option_count,is_ready,finalized_at
) VALUES (
    repeat('c',64),repeat('3',64),1,2,TRUE,clock_timestamp()
);

INSERT INTO private.exam_content_release_answers(
    release_id,question_id,correct_option_id,option_ids,option_percentages
) VALUES (
    repeat('c',64),93891,948911,ARRAY[948911,948912],'{"948911":75,"948912":25}'::jsonb
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99100000-0000-0000-0000-000000000001',true);

-- Simulate a session that already existed when migrations 065/066 roll out by
-- creating it through the pre-pinning v2 path.
CREATE TEMP TABLE legacy_create(payload jsonb);
INSERT INTO legacy_create
SELECT public.create_exam_session_bootstrap_idempotent_v2(
    '99100000-0000-0000-0000-000000000101',
    92891,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

CREATE TEMP TABLE legacy_session(id uuid);
INSERT INTO legacy_session
SELECT ((SELECT payload FROM legacy_create)->'session'->>'id')::uuid;

CREATE TEMP TABLE resumed(payload jsonb);
INSERT INTO resumed
SELECT public.get_exam_session_bootstrap_v3(
    (SELECT id FROM legacy_session),
    repeat('c',64)
);

SELECT extensions.is(
    jsonb_typeof((SELECT payload FROM resumed)->'session'->'content_release_id'),
    'null',
    'Resume never retrofits the currently active release onto a legacy session'
);

CREATE TEMP TABLE resumed_ref(payload jsonb);
INSERT INTO resumed_ref
SELECT public.get_exam_session_bootstrap_ref_v3(
    (SELECT id FROM legacy_session),
    repeat('c',64)
);

SELECT extensions.is(
    jsonb_typeof((SELECT payload FROM resumed_ref)->'session'->'content_release_id'),
    'null',
    'R2 ref resume also preserves explicit legacy mode'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT content_release_id FROM public.test_sessions WHERE id=(SELECT id FROM legacy_session)),
    NULL::text,
    'Legacy session row remains unpinned after resume attempts'
);

SELECT * FROM extensions.finish();
ROLLBACK;