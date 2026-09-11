BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(2);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '99300000-0000-0000-0000-000000000001',
    'authenticated','authenticated','release-coverage@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9196,'Release Coverage Pathway','test-release-coverage-pathway');

INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (92691,9196,'Release Coverage Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id)
VALUES ('99300000-0000-0000-0000-000000000001','bank',92691);

-- 93691 is live and selectable by the bank but intentionally absent from release E.
-- 93692 exists only so the ready release has a valid non-empty answer snapshot.
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(93691,193691,'Live-only question','Live-only explanation','Medicine','Coverage','1'),
(93692,193692,'Release-only question','Release-only explanation','Medicine','Coverage','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (92691,93691);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(946911,93691,'Live correct',TRUE,0,70),
(946912,93691,'Live wrong',FALSE,1,30),
(946921,93692,'Release correct',TRUE,0,60),
(946922,93692,'Release wrong',FALSE,1,40);

INSERT INTO private.exam_content_releases(
    release_id,manifest_sha256,question_count,option_count,is_ready,finalized_at
) VALUES (
    repeat('e',64),repeat('5',64),1,2,TRUE,clock_timestamp()
);

INSERT INTO private.exam_content_release_answers(
    release_id,question_id,correct_option_id,option_ids,option_percentages
) VALUES (
    repeat('e',64),93692,946921,ARRAY[946921,946922],'{"946921":60,"946922":40}'::jsonb
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','99300000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE mismatch_result(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.create_exam_session_bootstrap_idempotent_v3(
            '99300000-0000-0000-0000-000000000101',
            92691,'standard',1,
            ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all',repeat('e',64)
        );
        INSERT INTO mismatch_result VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO mismatch_result VALUES (SQLERRM LIKE '%CONTENT_RELEASE_SESSION_MISMATCH%');
    END;
END;
$$;

SELECT extensions.ok(
    (SELECT blocked FROM mismatch_result),
    'Create rejects a pinned release that does not cover every locked session question'
);

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::integer FROM public.test_sessions
     WHERE user_id='99300000-0000-0000-0000-000000000001'
       AND question_bank_id=92691),
    0,
    'Release coverage mismatch rolls the newly-created session back completely'
);

SELECT * FROM extensions.finish();
ROLLBACK;