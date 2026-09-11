BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(12);

SELECT extensions.ok(
    NOT has_function_privilege('anon','public.compute_question_bank_performance(bigint)','EXECUTE'),
    'anon cannot execute the internal performance computation'
);
SELECT extensions.ok(
    NOT has_function_privilege('authenticated','public.compute_question_bank_performance(bigint)','EXECUTE'),
    'authenticated cannot execute the internal performance computation directly'
);
SELECT extensions.ok(
    has_function_privilege('authenticated','public.get_question_bank_performance(bigint)','EXECUTE'),
    'authenticated can execute the cached performance RPC'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated','public.question_bank_performance_cache','SELECT'),
    'authenticated cannot read the internal performance cache table'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'e3000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','performance-cache@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (12301,'Performance Cache Pathway','test-performance-cache-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (12302,12301,'Performance Cache Bank',FALSE,NULL);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty) VALUES
(12303,22303,'Cache question one','Explanation','Cardiology','Cache','1'),
(12304,22304,'Cache question two','Explanation','Cardiology','Cache','2');
INSERT INTO public.question_bank_questions (question_bank_id,question_id) VALUES
(12302,12303),(12302,12304);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(123031,12303,'Correct',TRUE,0,80),(123032,12303,'Wrong',FALSE,1,20),
(123041,12304,'Correct',TRUE,0,50),(123042,12304,'Wrong',FALSE,1,50);

INSERT INTO public.user_access_grants (
    id,user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    12305,'e3000000-0000-0000-0000-000000000001','bank',12302,
    now() - interval '1 day', now() + interval '1 day'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE perf_cache_session(id uuid);
INSERT INTO perf_cache_session
SELECT public.create_exam_session(
    'e3000000-0000-0000-0000-000000000001',
    12302,
    'standard',
    2,
    ARRAY['1','2']::text[],
    ARRAY['Cardiology']::text[],
    '[]'::jsonb,
    'all'
);
SELECT public.get_exam_session_window((SELECT id FROM perf_cache_session),0,2);
SELECT public.submit_exam_answer((SELECT id FROM perf_cache_session),12303,123031,15);

CREATE TEMP TABLE perf_cache_first(payload jsonb);
INSERT INTO perf_cache_first SELECT public.get_question_bank_performance(12302);

RESET ROLE;

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM public.question_bank_performance_cache
        WHERE user_id='e3000000-0000-0000-0000-000000000001'
          AND question_bank_id=12302
          AND is_dirty=FALSE
          AND calculated_on=CURRENT_DATE
    ),
    'first performance call stores a clean cache entry for today'
);

CREATE TEMP TABLE perf_cache_stamp AS
SELECT updated_at
FROM public.question_bank_performance_cache
WHERE user_id='e3000000-0000-0000-0000-000000000001'
  AND question_bank_id=12302;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE perf_cache_second(payload jsonb);
INSERT INTO perf_cache_second SELECT public.get_question_bank_performance(12302);
RESET ROLE;

SELECT extensions.is(
    (SELECT payload FROM perf_cache_second),
    (SELECT payload FROM perf_cache_first),
    'a warm performance cache returns the same payload'
);
SELECT extensions.is(
    (SELECT updated_at FROM public.question_bank_performance_cache
     WHERE user_id='e3000000-0000-0000-0000-000000000001' AND question_bank_id=12302),
    (SELECT updated_at FROM perf_cache_stamp),
    'a warm cache hit does not rewrite the cached row'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);
SELECT public.submit_exam_answer((SELECT id FROM perf_cache_session),12304,123041,20);
RESET ROLE;

SELECT extensions.ok(
    (SELECT is_dirty FROM public.question_bank_performance_cache
     WHERE user_id='e3000000-0000-0000-0000-000000000001' AND question_bank_id=12302),
    'a new answer invalidates the cached performance payload'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);
CREATE TEMP TABLE perf_cache_recomputed(payload jsonb);
INSERT INTO perf_cache_recomputed SELECT public.get_question_bank_performance(12302);
RESET ROLE;

SELECT extensions.is(
    ((SELECT payload FROM perf_cache_recomputed)->>'answered')::int,
    2,
    'recomputation after invalidation includes the new answer'
);
SELECT extensions.ok(
    EXISTS (
        SELECT 1 FROM public.question_bank_performance_cache
        WHERE user_id='e3000000-0000-0000-0000-000000000001'
          AND question_bank_id=12302
          AND is_dirty=FALSE
          AND calculated_on=CURRENT_DATE
    ),
    'recomputation returns the cache to a clean state'
);

UPDATE public.options SET percentage=75 WHERE id=123031;
SELECT extensions.ok(
    (SELECT is_dirty FROM public.question_bank_performance_cache
     WHERE user_id='e3000000-0000-0000-0000-000000000001' AND question_bank_id=12302),
    'changing an option benchmark invalidates performance cache entries for the bank'
);

-- Refill, then confirm bank display metadata also invalidates the payload.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','e3000000-0000-0000-0000-000000000001',true);
SELECT public.get_question_bank_performance(12302);
RESET ROLE;
UPDATE public.question_banks SET name='Performance Cache Bank Updated' WHERE id=12302;
SELECT extensions.ok(
    (SELECT is_dirty FROM public.question_bank_performance_cache
     WHERE user_id='e3000000-0000-0000-0000-000000000001' AND question_bank_id=12302),
    'changing bank metadata invalidates cached performance payloads'
);

SELECT * FROM extensions.finish();
ROLLBACK;
