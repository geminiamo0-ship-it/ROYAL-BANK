BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(7);

-- Deterministic users. The auth trigger creates matching public.profiles rows.
INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'global@test.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'pathway@test.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
),
(
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', 'bank@test.local', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO public.pathways (id, name, slug)
VALUES
    (9101, 'Access Pathway A', 'test-access-pathway-a'),
    (9102, 'Access Pathway B', 'test-access-pathway-b');

INSERT INTO public.question_banks (
    id, pathway_id, name, is_free_trial, free_trial_block_limit
) VALUES
    (9201, 9101, 'Access Bank A1', FALSE, NULL),
    (9203, 9102, 'Access Bank B1', FALSE, NULL);

-- Global user.
INSERT INTO public.user_access_grants (user_id, scope_type)
VALUES ('10000000-0000-0000-0000-000000000001', 'global');

-- Pathway grant is created before the second bank in that pathway. This proves
-- the grant automatically covers banks added in the future.
INSERT INTO public.user_access_grants (user_id, scope_type, pathway_id)
VALUES ('10000000-0000-0000-0000-000000000002', 'pathway', 9101);

INSERT INTO public.question_banks (
    id, pathway_id, name, is_free_trial, free_trial_block_limit
) VALUES (9202, 9101, 'Access Bank A2 Future', FALSE, NULL);

-- Bank-scoped user.
INSERT INTO public.user_access_grants (user_id, scope_type, question_bank_id)
VALUES ('10000000-0000-0000-0000-000000000003', 'bank', 9201);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT extensions.ok(public.can_access_question_bank(9201), 'global grant covers first bank');
SELECT extensions.ok(public.can_access_question_bank(9203), 'global grant covers another pathway');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT extensions.ok(public.can_access_question_bank(9201), 'pathway grant covers existing bank');
SELECT extensions.ok(public.can_access_question_bank(9202), 'pathway grant covers bank added after grant');
SELECT extensions.ok(NOT public.can_access_question_bank(9203), 'pathway grant does not cross pathways');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
SELECT extensions.ok(public.can_access_question_bank(9201), 'bank grant covers selected bank');
SELECT extensions.ok(NOT public.can_access_question_bank(9202), 'bank grant does not cover sibling bank');

SELECT * FROM extensions.finish();
ROLLBACK;
