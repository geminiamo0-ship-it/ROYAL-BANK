BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(2);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'a2000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','history-rpc@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

INSERT INTO public.pathways (id,name,slug)
VALUES (13201,'History RPC Pathway','test-history-rpc-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (13301,13201,'History RPC Bank',FALSE,NULL);
INSERT INTO public.questions (id,main_id,text_html,explanation_html,category,topic,difficulty)
VALUES (13401,23401,'History question','History explanation','History Category','History Topic','1');
INSERT INTO public.question_bank_questions (question_bank_id,question_id)
VALUES (13301,13401);
INSERT INTO public.options (id,question_id,text_html,is_correct,option_order,percentage) VALUES
(135011,13401,'Correct',TRUE,0,70),(135012,13401,'Wrong',FALSE,1,30);
INSERT INTO public.user_access_grants (
    id,user_id,scope_type,question_bank_id,starts_at,expires_at
) VALUES (
    13601,'a2000000-0000-0000-0000-000000000001','bank',13301,
    now() - interval '1 day', now() + interval '1 day'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000001',true);

CREATE TEMP TABLE history_session(id uuid);
INSERT INTO history_session
SELECT public.create_exam_session(
    'a2000000-0000-0000-0000-000000000001',
    13301,
    'standard',
    1,
    ARRAY['1']::text[],
    ARRAY['History Category']::text[],
    '[]'::jsonb,
    'all'
);

RESET ROLE;
UPDATE public.user_access_grants
SET expires_at = now() - interval '1 minute'
WHERE id = 13601;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','a2000000-0000-0000-0000-000000000001',true);

SELECT extensions.ok(
    NOT public.can_access_question_bank(13301),
    'current bank access is expired'
);
SELECT extensions.is(
    (SELECT count(*)::bigint FROM public.get_my_bank_sessions(13301,100)),
    1::bigint,
    'owned session history remains listable after access expiry'
);

SELECT * FROM extensions.finish();
ROLLBACK;