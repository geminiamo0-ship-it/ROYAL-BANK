BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.ok(
    has_function_privilege(
        'authenticated',
        'public.create_exam_session_bootstrap(bigint,text,integer,text[],text[],jsonb,text)'::regprocedure,
        'EXECUTE'
    ),
    'authenticated users can execute the public create-bootstrap RPC'
);

SELECT extensions.ok(
    NOT has_function_privilege(
        'anon',
        'public.create_exam_session_bootstrap(bigint,text,integer,text[],text[],jsonb,text)'::regprocedure,
        'EXECUTE'
    ),
    'anon cannot execute the create-bootstrap RPC'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'e0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','inline-owner@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'e0000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','inline-trial@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'e0000000-0000-0000-0000-000000000003',
    'authenticated','authenticated','inline-inactive@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug) VALUES
(9890,'Inline Premium Pathway','test-inline-premium-pathway'),
(9891,'Inline Trial Pathway','test-inline-trial-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES
(9899,9890,'Inline Premium Bank',FALSE,NULL,70),
(9898,9891,'Inline Trial Bank',TRUE,1,2);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('e0000000-0000-0000-0000-000000000001','bank',9899),
('e0000000-0000-0000-0000-000000000003','bank',9899);

UPDATE public.profiles
SET is_active = FALSE
WHERE id = 'e0000000-0000-0000-0000-000000000003';

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(9901,19901,'Inline premium Q1','SECRET inline premium E1','Inline','Premium One','1'),
(9902,19902,'Inline premium Q2','SECRET inline premium E2','Inline','Premium Two','1'),
(9911,19911,'Inline trial Q1','SECRET inline trial E1','Inline','Trial One','1'),
(9912,19912,'Inline trial Q2','SECRET inline trial E2','Inline','Trial Two','1');

INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(9899,9901),(9899,9902),
(9898,9911),(9898,9912);

INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(99011,9901,'P1 A',TRUE,0,75),(99012,9901,'P1 B',FALSE,1,25),
(99021,9902,'P2 A',FALSE,0,35),(99022,9902,'P2 B',TRUE,1,65),
(99111,9911,'T1 A',TRUE,0,55),(99112,9911,'T1 B',FALSE,1,45),
(99121,9912,'T2 A',FALSE,0,40),(99122,9912,'T2 B',TRUE,1,60);

INSERT INTO public.user_question_flags (user_id,question_id) VALUES
('e0000000-0000-0000-0000-000000000001',9902);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE inline_bootstrap_payload(payload jsonb);
INSERT INTO inline_bootstrap_payload
SELECT public.create_exam_session_bootstrap(
    9899,'tutor',2,
    ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT extensions.is(
    (SELECT payload->>'status' FROM inline_bootstrap_payload),
    'active'::text,
    'inline bootstrap creates an active premium session'
);

SELECT extensions.is(
    (SELECT payload FROM inline_bootstrap_payload),
    public.get_exam_session_bootstrap(
        (SELECT (payload->'session'->>'id')::uuid FROM inline_bootstrap_payload)
    ),
    'inline create response exactly matches an authoritative bootstrap reload'
);

SELECT extensions.is(
    (SELECT payload->'flagged_question_ids' FROM inline_bootstrap_payload),
    '[9902]'::jsonb,
    'inline response preserves session flag payload semantics'
);

SELECT extensions.is(
    (SELECT jsonb_array_length(payload->'answers') FROM inline_bootstrap_payload),
    0,
    'brand-new inline bootstrap has no answers'
);

SELECT extensions.is(
    (SELECT (payload->>'current_index')::integer FROM inline_bootstrap_payload),
    0,
    'brand-new inline bootstrap starts at question index zero'
);

SELECT extensions.ok(
    position(
        'RETURN public.get_exam_session_bootstrap' in
        pg_get_functiondef(
            'public.create_exam_session_bootstrap(bigint,text,integer,text[],text[],jsonb,text)'::regprocedure
        )
    ) = 0,
    'create bootstrap no longer performs the read-after-write bootstrap reload'
);

RESET ROLE;
SELECT extensions.ok(
    regexp_count(
        pg_get_functiondef(
            'private.create_exam_session_bootstrap_core(bigint,text,integer,text[],text[],jsonb,text)'::regprocedure
        ),
        'public\.can_access_question_bank\(new_session\.question_bank_id\)'
    ) >= 2,
    'private inline create core preserves both fresh post-insert bank-access checks from bootstrap + window'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000002',true);
CREATE TEMP TABLE inline_trial_payload(payload jsonb);
SELECT extensions.lives_ok(
    $$INSERT INTO inline_trial_payload
      SELECT public.create_exam_session_bootstrap(
          9898,'tutor',2,
          ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
      )$$,
    'first trial block still succeeds through inline bootstrap'
);

SELECT extensions.is(
    (SELECT count(*)::bigint
     FROM public.free_trial_block_usage
     WHERE user_id='e0000000-0000-0000-0000-000000000002'
       AND question_bank_id=9898),
    1::bigint,
    'inline bootstrap still records exactly one trial usage ledger entry'
);

SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session_bootstrap(
        9898,'tutor',2,
        ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
    )$$,
    'Free-trial block quota exhausted',
    'trial advisory-lock/quota trigger still blocks an over-limit second block'
);

SELECT set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000003',true);
SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session_bootstrap(
        9899,'tutor',1,
        ARRAY['1']::text[],ARRAY[]::text[],'[]'::jsonb,'all'
    )$$,
    'Account is inactive',
    'inactive granted user remains blocked by inline bootstrap'
);

SELECT * FROM extensions.finish();
ROLLBACK;
