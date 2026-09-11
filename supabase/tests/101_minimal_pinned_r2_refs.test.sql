BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '99200000-0000-0000-0000-000000000001',
    'authenticated','authenticated','minimal-r2-ref@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9197,'Minimal R2 Ref Pathway','test-minimal-r2-ref-pathway');

INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (92791,9197,'Minimal R2 Ref Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('99200000-0000-0000-0000-000000000001','bank',92791);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (93791,193791,'Pinned ref question','Pinned ref explanation','Medicine','Pinned refs','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (92791,93791);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(947911,93791,'Release correct',TRUE,0,80),
(947912,93791,'Release wrong',FALSE,1,20);

INSERT INTO private.exam_content_releases(
    release_id,manifest_sha256,question_count,option_count,is_ready,finalized_at
) VALUES (
    repeat('d',64),repeat('4',64),1,2,TRUE,clock_timestamp()
);

INSERT INTO private.exam_content_release_answers(
    release_id,question_id,correct_option_id,option_ids,option_percentages
) VALUES (
    repeat('d',64),93791,947911,ARRAY[947911,947912],'{"947911":80,"947912":20}'::jsonb
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99200000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE created(payload jsonb);
INSERT INTO created
SELECT public.create_exam_session_bootstrap_idempotent_v3(
    '99200000-0000-0000-0000-000000000101',
    92791,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all',repeat('d',64)
);

CREATE TEMP TABLE session_id(id uuid);
INSERT INTO session_id
SELECT ((SELECT payload FROM created)->'session'->>'id')::uuid;

CREATE TEMP TABLE training_ref(payload jsonb);
INSERT INTO training_ref
SELECT public.get_exam_training_feedback_ref_v2((SELECT id FROM session_id),93791);

SELECT extensions.ok(
    NOT ((SELECT payload FROM training_ref) ? 'correct_option_id')
    AND NOT ((SELECT payload FROM training_ref) ? 'option_percentages')
    AND NOT ((SELECT payload FROM training_ref) ? 'explanation_html'),
    'Pinned training ref returns authorization/release state without protected live content'
);

-- Flip the mutable/live key after the release was pinned. Every pinned correctness
-- surface below must continue to use release D (947911).
RESET ROLE;
UPDATE public.options SET is_correct=FALSE WHERE id=947911;
UPDATE public.options SET is_correct=TRUE WHERE id=947912;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99200000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE submitted(payload jsonb);
INSERT INTO submitted
SELECT public.submit_exam_answer_idempotent(
    '99200000-0000-0000-0000-000000000102',
    (SELECT id FROM session_id),93791,947911,4
);

SELECT extensions.is(
    ((SELECT payload FROM submitted)->>'is_correct')::boolean,
    TRUE,
    'Pinned submit still scores against the release snapshot after live key mutation'
);

CREATE TEMP TABLE feedback_ref(payload jsonb);
INSERT INTO feedback_ref
SELECT public.get_exam_question_feedback_ref_v2((SELECT id FROM session_id),93791);

SELECT extensions.ok(
    NOT ((SELECT payload FROM feedback_ref) ? 'correct_option_id')
    AND NOT ((SELECT payload FROM feedback_ref) ? 'option_percentages')
    AND NOT ((SELECT payload FROM feedback_ref) ? 'explanation_html'),
    'Pinned answered feedback ref avoids protected live content reads'
);

CREATE TEMP TABLE resumed(payload jsonb);
INSERT INTO resumed
SELECT public.get_exam_session_bootstrap_ref_v3((SELECT id FROM session_id),NULL);

SELECT extensions.is(
    ((SELECT payload FROM resumed)->'answers'->0->>'correct_option_id')::bigint,
    947911::bigint,
    'Pinned active bootstrap answer metadata comes from the release snapshot'
);

SELECT public.complete_exam_session((SELECT id FROM session_id));

CREATE TEMP TABLE review_bootstrap(payload jsonb);
INSERT INTO review_bootstrap
SELECT public.get_completed_exam_review_bootstrap_ref_v2((SELECT id FROM session_id),NULL);

SELECT extensions.is(
    ((SELECT payload FROM review_bootstrap)->'answers'->0->>'correct_option_id')::bigint,
    947911::bigint,
    'Pinned completed review bootstrap answer metadata comes from the release snapshot'
);

CREATE TEMP TABLE review_ref(payload jsonb);
INSERT INTO review_ref
SELECT public.get_completed_exam_review_feedback_ref_v2((SELECT id FROM session_id),93791);

SELECT extensions.ok(
    NOT ((SELECT payload FROM review_ref) ? 'correct_option_id')
    AND NOT ((SELECT payload FROM review_ref) ? 'option_percentages')
    AND NOT ((SELECT payload FROM review_ref) ? 'explanation_html'),
    'Pinned review feedback ref avoids protected live content reads'
);

SELECT * FROM extensions.finish();
ROLLBACK;