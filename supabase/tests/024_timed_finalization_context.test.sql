BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(11);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'private.exam_timed_finalization_context', 'SELECT'),
    'authenticated cannot read timed-finalization context'
);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'private.exam_timed_finalization_context', 'INSERT'),
    'authenticated cannot forge timed-finalization context'
);

SELECT extensions.ok(
    NOT has_table_privilege('anon', 'private.exam_timed_finalization_context', 'SELECT'),
    'anon cannot read timed-finalization context'
);

SELECT extensions.ok(
    (SELECT relrowsecurity
     FROM pg_class
     WHERE oid = 'private.exam_timed_finalization_context'::regclass),
    'timed-finalization context has RLS enabled as an additional boundary'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f5000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','timed-context@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways(id,name,slug)
VALUES (9940,'Timed Context Pathway','test-timed-context-pathway');

INSERT INTO public.question_banks(
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES (9941,9940,'Timed Context Bank',FALSE,NULL,70);

INSERT INTO public.user_access_grants(user_id,scope_type,question_bank_id)
VALUES ('f5000000-0000-0000-0000-000000000001','bank',9941);

INSERT INTO public.questions(id,main_id,text_html,explanation_html,category,topic,difficulty)
SELECT
    994100 + n,
    1994100 + n,
    'Timed context question ' || n,
    'SECRET timed context explanation ' || n,
    'Timed Context',
    'Topic ' || n,
    '1'
FROM generate_series(1,2) AS n;

INSERT INTO public.question_bank_questions(question_bank_id,question_id)
SELECT 9941, 994100 + n
FROM generate_series(1,2) AS n;

INSERT INTO public.options(id,question_id,text_html,is_correct,option_order,percentage)
SELECT 99410000 + n * 10 + 1, 994100 + n, 'Correct ' || n, TRUE, 0, 60
FROM generate_series(1,2) AS n
UNION ALL
SELECT 99410000 + n * 10 + 2, 994100 + n, 'Incorrect ' || n, FALSE, 1, 40
FROM generate_series(1,2) AS n;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f5000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE timed_context_bootstrap(payload jsonb);
INSERT INTO timed_context_bootstrap
SELECT public.create_exam_session_bootstrap(
    9941,'timed',2,ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

-- A caller can set arbitrary custom GUC text in its own transaction. That must not
-- become trusted proof for the NULL rows reserved for End Block bookkeeping.
SELECT set_config('app.timed_finalization','on',true);

SELECT extensions.throws_ok(
    $$SELECT public.submit_exam_answer(
        (SELECT (payload->'session'->>'id')::uuid FROM timed_context_bootstrap),
        (SELECT (payload->'question_ids'->>0)::bigint FROM timed_context_bootstrap),
        NULL,
        0
    )$$,
    'Submitted answer requires a selected option',
    'spoofing the legacy custom GUC cannot authorize a NULL answer'
);

RESET ROLE;

SELECT extensions.is(
    (
        SELECT count(*)::bigint
        FROM public.user_answers ua
        WHERE ua.test_session_id = (
            SELECT (payload->'session'->>'id')::uuid
            FROM timed_context_bootstrap
        )
    ),
    0::bigint,
    'failed GUC spoof leaves no answer row behind'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f5000000-0000-0000-0000-000000000001',true);

SELECT extensions.lives_ok(
    $$SELECT public.complete_exam_session(
        (SELECT (payload->'session'->>'id')::uuid FROM timed_context_bootstrap)
    )$$,
    'trusted timed completion still finalizes unanswered locked questions'
);

RESET ROLE;

SELECT extensions.is(
    (
        SELECT count(*)::bigint
        FROM public.user_answers ua
        WHERE ua.test_session_id = (
            SELECT (payload->'session'->>'id')::uuid
            FROM timed_context_bootstrap
        )
          AND ua.user_id = 'f5000000-0000-0000-0000-000000000001'
          AND ua.selected_option_id IS NULL
          AND ua.is_correct = FALSE
    ),
    2::bigint,
    'timed completion records both unanswered questions as incorrect'
);

SELECT extensions.ok(
    (
        SELECT is_completed
        FROM public.test_sessions
        WHERE id = (
            SELECT (payload->'session'->>'id')::uuid
            FROM timed_context_bootstrap
        )
    ),
    'timed session is completed normally'
);

SELECT extensions.is(
    (SELECT count(*)::bigint FROM private.exam_timed_finalization_context),
    0::bigint,
    'trusted transaction marker is removed before commit'
);

SELECT extensions.ok(
    pg_get_functiondef('public.validate_user_answer_relationships()'::regprocedure)
        NOT ILIKE '%app.timed_finalization%'
    AND pg_get_functiondef('public.complete_exam_session(uuid)'::regprocedure)
        NOT ILIKE '%app.timed_finalization%',
    'security-critical timed finalization no longer depends on a custom GUC'
);

SELECT * FROM extensions.finish();
ROLLBACK;
