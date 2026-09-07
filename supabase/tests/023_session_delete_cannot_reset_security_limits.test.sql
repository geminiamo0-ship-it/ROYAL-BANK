BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(6);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'f7000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','delete-limit@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways(id,name,slug)
VALUES (9970,'Delete Limit Pathway','test-delete-limit-pathway');
INSERT INTO public.question_banks(
    id,pathway_id,name,is_free_trial,free_trial_block_limit,free_trial_question_limit
) VALUES (9971,9970,'Delete Limit Bank',FALSE,NULL,70);
INSERT INTO public.user_access_grants(user_id,scope_type,question_bank_id)
VALUES ('f7000000-0000-0000-0000-000000000001','bank',9971);
INSERT INTO public.questions(id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9972,19972,'Delete-limit question','Delete-limit explanation','Audit','Delete','1');
INSERT INTO public.question_bank_questions(question_bank_id,question_id)
VALUES (9971,9972);
INSERT INTO public.options(id,question_id,text_html,is_correct,option_order,percentage)
VALUES
(99721,9972,'Correct',TRUE,0,50),
(99722,9972,'Wrong',FALSE,1,50);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f7000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE deleted_creation_ids(id uuid);
DO $$
DECLARE
    i INTEGER;
    s UUID;
BEGIN
    FOR i IN 1..4 LOOP
        s := public.create_exam_session(
            'f7000000-0000-0000-0000-000000000001',
            9971,
            'standard',
            1,
            ARRAY[]::text[],
            ARRAY[]::text[],
            '[]'::jsonb,
            'all'
        );
        INSERT INTO deleted_creation_ids VALUES (s);
        DELETE FROM public.test_sessions WHERE id=s;
    END LOOP;
END;
$$;

RESET ROLE;
SELECT extensions.is(
    (SELECT count(*)::bigint
     FROM public.test_sessions
     WHERE user_id='f7000000-0000-0000-0000-000000000001'),
    0::bigint,
    'all four incomplete public session rows were deleted'
);

SELECT extensions.is(
    (SELECT count(*)::bigint
     FROM private.exam_security_events
     WHERE user_id='f7000000-0000-0000-0000-000000000001'
       AND event_type='session_created'),
    4::bigint,
    'immutable creation events survive deletion'
);

SELECT extensions.is(
    (SELECT count(*)::bigint
     FROM private.exam_security_events
     WHERE user_id='f7000000-0000-0000-0000-000000000001'
       AND event_type='session_created'
       AND session_id IS NULL),
    4::bigint,
    'session-id foreign keys are cleared but security events remain'
);

SELECT extensions.ok(
    (SELECT session_create_blocked_until > clock_timestamp()
     FROM private.exam_security_account_state
     WHERE user_id='f7000000-0000-0000-0000-000000000001'),
    'fourth creation activates the burst cooldown even after every session is deleted'
);

SELECT extensions.is(
    (SELECT session_create_block_reason
     FROM private.exam_security_account_state
     WHERE user_id='f7000000-0000-0000-0000-000000000001'),
    'SESSION_BURST_LIMIT',
    'the durable block reason remains SESSION_BURST_LIMIT'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f7000000-0000-0000-0000-000000000001',true);

SELECT extensions.throws_ok(
    $$SELECT public.create_exam_session(
        'f7000000-0000-0000-0000-000000000001',
        9971,
        'standard',
        1,
        ARRAY[]::text[],
        ARRAY[]::text[],
        '[]'::jsonb,
        'all'
    )$$,
    'SESSION_BURST_LIMIT',
    'deleting sessions cannot reset the creation burst limit'
);

SELECT * FROM extensions.finish();
ROLLBACK;
