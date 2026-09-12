BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '26000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','single-bank@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '26000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','library-trial@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9610,'Library Access Pathway','test-library-access-pathway');

INSERT INTO public.question_banks (
    id,pathway_id,name,is_free_trial,free_trial_block_limit,
    free_trial_question_limit,free_trial_article_limit
) VALUES
    (9621,9610,'Library Bank One',TRUE,2,70,2),
    (9622,9610,'Library Bank Two',FALSE,NULL,70,0),
    (9623,9610,'Library Bank Three',FALSE,NULL,70,0);

INSERT INTO public.library_articles (id,name,category,content_html,source)
VALUES
    ('test_library_1','Library Article One','Cardiology','<p>Article one</p>','test'),
    ('test_library_2','Library Article Two','Neurology','<p>Article two</p>','test'),
    ('test_library_3','Library Article Three','Respiratory','<p>Article three</p>','test'),
    ('test_library_bank2','Bank Two Article','Renal','<p>Bank two</p>','test'),
    ('test_library_bank3','Bank Three Article','GI','<p>Bank three</p>','test');

INSERT INTO public.question_bank_library_articles(question_bank_id,article_id,display_order)
VALUES
    (9621,'test_library_1',1),
    (9621,'test_library_2',2),
    (9621,'test_library_3',3),
    (9622,'test_library_bank2',1),
    (9623,'test_library_bank3',1);

-- A single bank subscription unlocks only that bank and its mapped library.
INSERT INTO public.user_access_grants(user_id,scope_type,question_bank_id)
VALUES ('26000000-0000-0000-0000-000000000001','bank',9621);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(public.can_access_question_bank(9621),'explicit bank grant is active');
SELECT extensions.ok(NOT public.can_access_question_bank(9622),'ungranted sibling bank stays locked');
SELECT extensions.ok(NOT public.can_access_question_bank(9623),'another ungranted sibling bank stays locked');
SELECT extensions.ok(public.can_access_library_article(9621,'test_library_1'),'bank entitlement covers its library');
SELECT extensions.ok(NOT public.can_access_library_article(9622,'test_library_bank2'),'sibling bank library stays locked');
SELECT extensions.ok(NOT public.can_access_library_article(9623,'test_library_bank3'),'another locked bank library stays locked');

-- Trial library quota counts unique articles, not repeat opens.
SELECT set_config('request.jwt.claim.sub','26000000-0000-0000-0000-000000000002',true);
SELECT extensions.ok(public.can_access_library_article(9621,'test_library_1'),'trial user may disclose first article');
SELECT extensions.is(
    (public.get_library_article(9621,'test_library_1')->'access'->>'trial_remaining')::INTEGER,
    1,
    'first unique trial article consumes one slot'
);
SELECT extensions.is(
    (public.get_library_article(9621,'test_library_1')->'access'->>'trial_remaining')::INTEGER,
    1,
    'reopening the same article does not consume another slot'
);
SELECT extensions.is(
    (public.get_library_article(9621,'test_library_2')->'access'->>'trial_remaining')::INTEGER,
    0,
    'second unique article exhausts the two-article trial quota'
);
SELECT extensions.ok(
    NOT public.can_access_library_article(9621,'test_library_3'),
    'third undisclosed article is no longer accessible'
);
SELECT extensions.throws_ok(
    $$SELECT public.get_library_article(9621,'test_library_3')$$,
    'LIBRARY_TRIAL_LIMIT',
    'article body RPC enforces the exhausted trial quota'
);

RESET ROLE;
SELECT extensions.ok(
    to_regclass('public.user_pathway_access') IS NULL,
    'legacy user_pathway_access table is removed'
);

SELECT * FROM extensions.finish();
ROLLBACK;
