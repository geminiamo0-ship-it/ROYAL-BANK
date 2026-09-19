BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '25000000-0000-0000-0000-000000000105',
    'authenticated','authenticated','library-cache@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (10510,'Library Cache Pathway','test-library-cache-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES (10521,10510,'Library Cache Bank',TRUE,2,70,1);

INSERT INTO public.library_articles (id,name,category,content_html,source)
VALUES
    ('cache_article_1','Cached Article One','Cardiology','<p>one</p>','test'),
    ('cache_article_2','Cached Article Two','Neurology','<p>two</p>','test');

INSERT INTO public.question_bank_library_articles(question_bank_id,article_id,display_order)
VALUES
    (10521,'cache_article_1',1),
    (10521,'cache_article_2',2);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','25000000-0000-0000-0000-000000000105',true);

SELECT extensions.throws_ok(
    $$SELECT public.get_library_article_content_authorized(10521,'cache_article_1')$$,
    'LIBRARY_ACCESS_DENIED',
    'content-only fallback cannot disclose a fresh trial article'
);

SELECT extensions.is(
    (public.authorize_library_article_read(10521,'cache_article_1')->'access'->>'trial_remaining')::INTEGER,
    0,
    'authorization consumes the single trial disclosure slot'
);

SELECT extensions.is(
    public.get_library_article_content_authorized(10521,'cache_article_1')->>'content_html',
    '<p>one</p>',
    'authorized disclosed trial article can use content fallback'
);

SELECT extensions.is(
    (public.authorize_library_article_read(10521,'cache_article_1')->'access'->>'trial_remaining')::INTEGER,
    0,
    'reopen is idempotent and consumes no extra slot'
);

SELECT extensions.throws_ok(
    $$SELECT public.authorize_library_article_read(10521,'cache_article_2')$$,
    'LIBRARY_TRIAL_LIMIT',
    'second fresh article is denied when trial quota is exhausted'
);

SELECT extensions.throws_ok(
    $$SELECT public.get_library_article_content_authorized(10521,'cache_article_2')$$,
    'LIBRARY_ACCESS_DENIED',
    'content fallback cannot bypass exhausted quota'
);

RESET ROLE;

SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.authorize_library_article_read(bigint,text)', 'EXECUTE'),
    'authenticated may call authorization boundary'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.library_articles', 'SELECT'),
    'direct library table reads remain unavailable to authenticated users'
);

SELECT * FROM extensions.finish();
ROLLBACK;
