BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
('00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000001','authenticated','authenticated','future@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000002','authenticated','authenticated','expired@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()),
('00000000-0000-0000-0000-000000000000','60000000-0000-0000-0000-000000000003','authenticated','authenticated','active@test.local','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());

INSERT INTO public.pathways (id,name,slug) VALUES (9160,'Window Pathway','test-window-pathway');
INSERT INTO public.question_banks (id,pathway_id,name,is_free_trial,free_trial_block_limit)
VALUES (9260,9160,'Window Bank',FALSE,NULL);

INSERT INTO public.user_access_grants (user_id,scope_type,question_bank_id,starts_at,expires_at) VALUES
('60000000-0000-0000-0000-000000000001','bank',9260,now()+interval '1 day',now()+interval '2 days'),
('60000000-0000-0000-0000-000000000002','bank',9260,now()-interval '2 days',now()-interval '1 day'),
('60000000-0000-0000-0000-000000000003','bank',9260,now()-interval '1 day',now()+interval '1 day');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);

SELECT set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000001',true);
SELECT extensions.ok(NOT public.has_premium_question_bank_access(9260),'future grant is not active early');

SELECT set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000002',true);
SELECT extensions.ok(NOT public.has_premium_question_bank_access(9260),'expired grant no longer gives premium access');

SELECT set_config('request.jwt.claim.sub','60000000-0000-0000-0000-000000000003',true);
SELECT extensions.ok(public.has_premium_question_bank_access(9260),'currently active grant gives premium access');
SELECT extensions.ok(public.can_access_question_bank(9260),'active premium grant gives bank access');

SELECT * FROM extensions.finish();
ROLLBACK;
