BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'c0000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','expired-history@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (9201,'Expired History Pathway','test-expired-history-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9301,9201,'Expired History Bank',FALSE,NULL);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (9401,19401,'Historical question','Historical explanation','History','Access','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (9301,9401);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(95011,9401,'Correct',TRUE,0,70),(95012,9401,'Wrong',FALSE,1,30);

INSERT INTO public.user_access_grants (
    id,user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    9601,'c0000000-0000-0000-0000-000000000001','bank',9301,
    now() - interval '2 days', now() + interval '1 day'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE historical_session(id uuid);
INSERT INTO historical_session
SELECT public.create_exam_session(
    'c0000000-0000-0000-0000-000000000001',9301,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

SELECT public.get_exam_session_window((SELECT id FROM historical_session),0,1);
SELECT public.submit_exam_answer((SELECT id FROM historical_session),9401,95011,5);
SELECT public.complete_exam_session((SELECT id FROM historical_session));

CREATE TEMP TABLE stale_incomplete_session(id uuid);
INSERT INTO stale_incomplete_session
SELECT public.create_exam_session(
    'c0000000-0000-0000-0000-000000000001',9301,'standard',1,
    ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
);

RESET ROLE;
INSERT INTO public.user_notes (user_id,question_id,note_html)
VALUES ('c0000000-0000-0000-0000-000000000001',9401,'Historical note');
INSERT INTO public.saved_concepts (user_id,question_id,concept_text,is_important)
VALUES ('c0000000-0000-0000-0000-000000000001',9401,'Historical concept',TRUE);
INSERT INTO public.user_question_flags (user_id,question_id)
VALUES ('c0000000-0000-0000-0000-000000000001',9401);

UPDATE public.user_access_grants
SET expires_at = now() - interval '1 day'
WHERE id = 9601;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    NOT public.can_access_question_bank(9301),
    'expired grant no longer authorizes the bank'
);

SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_sessions WHERE id=(SELECT id FROM historical_session)),
    1::bigint,
    'expired user can still read owned session history'
);
SELECT extensions.is(
    (SELECT count(id)::bigint FROM public.user_answers WHERE test_session_id=(SELECT id FROM historical_session)),
    1::bigint,
    'expired user can still read owned answer history'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.user_notes WHERE question_id=9401),
    1::bigint,
    'expired user can still read owned note history'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.saved_concepts WHERE question_id=9401),
    1::bigint,
    'expired user can still read owned concept history'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.user_question_flags WHERE question_id=9401),
    1::bigint,
    'expired user can still read owned flag history'
);

CREATE TEMP TABLE expired_create_attempt(blocked boolean);
DO $$
BEGIN
    BEGIN
        PERFORM public.create_exam_session(
            'c0000000-0000-0000-0000-000000000001',9301,'standard',1,
            ARRAY[]::text[],ARRAY[]::text[],'[]'::jsonb,'all'
        );
        INSERT INTO expired_create_attempt VALUES (FALSE);
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO expired_create_attempt VALUES (TRUE);
    END;
END;
$$;
SELECT extensions.ok((SELECT blocked FROM expired_create_attempt),'expired user cannot create a new session');

SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.test_sessions WHERE id=(SELECT id FROM stale_incomplete_session)),
    1::bigint,
    'expired user can still see owned incomplete session metadata'
);

CREATE TEMP TABLE expired_update_attempt(rows_changed bigint);
DO $$
DECLARE
    changed bigint;
BEGIN
    UPDATE public.test_sessions
    SET time_limit_minutes = 10
    WHERE id=(SELECT id FROM stale_incomplete_session);
    GET DIAGNOSTICS changed = ROW_COUNT;
    INSERT INTO expired_update_attempt VALUES (changed);
END;
$$;
SELECT extensions.is(
    (SELECT rows_changed FROM expired_update_attempt),
    0::bigint,
    'expired user cannot resume/update an incomplete session'
);

SELECT * FROM extensions.finish();
ROLLBACK;