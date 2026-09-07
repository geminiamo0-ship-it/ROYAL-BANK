BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(8);

-- A normal owner, another authenticated user, and a signup that attempts role escalation.
INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000000',
    'b0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','owner-security@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'b0000000-0000-0000-0000-000000000002',
    'authenticated','authenticated','other-security@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
),
(
    '00000000-0000-0000-0000-000000000000',
    'b0000000-0000-0000-0000-000000000003',
    'authenticated','authenticated','escalation@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"role":"admin","subscription_tier":"premium_full"}'::jsonb,now(),now()
);

SELECT extensions.is(
    (SELECT role FROM public.profiles WHERE id='b0000000-0000-0000-0000-000000000003'),
    'student'::text,
    'signup metadata cannot self-promote a user to admin'
);
SELECT extensions.is(
    (SELECT subscription_tier FROM public.profiles WHERE id='b0000000-0000-0000-0000-000000000003'),
    'free_trial'::text,
    'signup metadata cannot self-promote subscription tier'
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9199,'Security Pathway','test-security-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9299,9199,'Security Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id) VALUES
('b0000000-0000-0000-0000-000000000001','bank',9299),
('b0000000-0000-0000-0000-000000000002','bank',9299);

INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9399,19399,'Ownership security question','Ownership security explanation','Security','Ownership','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (9299,9399);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(94991,9399,'A',TRUE,0,50),(94992,9399,'B',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    public.can_access_question_bank(9299),
    'active authenticated owner can access a granted bank'
);

CREATE TEMP TABLE owner_session(id uuid);
INSERT INTO owner_session
SELECT public.create_exam_session(
    'b0000000-0000-0000-0000-000000000001',9299,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_sessions WHERE id=(SELECT id FROM owner_session)),
    1::bigint,
    'session owner can read their own session'
);

SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',true);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_sessions WHERE id=(SELECT id FROM owner_session)),
    0::bigint,
    'another authenticated user cannot read the owner session'
);

CREATE TEMP TABLE foreign_delete_attempt(blocked boolean);
DO $$
BEGIN
    BEGIN
        DELETE FROM public.test_sessions WHERE id=(SELECT id FROM owner_session);
        INSERT INTO foreign_delete_attempt VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO foreign_delete_attempt VALUES (TRUE);
    END;
END;
$$;

RESET ROLE;
SELECT extensions.ok(
    EXISTS (SELECT 1 FROM public.test_sessions WHERE id=(SELECT id FROM owner_session)),
    'another user cannot delete the owner session'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000003',true);
SELECT extensions.ok(
    NOT public.can_access_question_bank(9299),
    'authenticated user without a grant cannot access the bank'
);

RESET ROLE;
UPDATE public.profiles
SET is_active=FALSE
WHERE id='b0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001',true);
SELECT extensions.ok(
    NOT public.can_access_question_bank(9299),
    'inactive user cannot access a bank even with an active grant'
);

SELECT * FROM extensions.finish();
ROLLBACK;
