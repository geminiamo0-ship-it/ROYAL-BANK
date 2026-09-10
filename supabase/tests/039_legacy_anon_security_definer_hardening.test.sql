BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(24);

SELECT extensions.is(has_function_privilege('anon','public.audit_bank_access_change()','EXECUTE'),FALSE,'anon cannot execute audit_bank_access_change');
SELECT extensions.is(has_function_privilege('anon','public.audit_profile_access_change()','EXECUTE'),FALSE,'anon cannot execute audit_profile_access_change');
SELECT extensions.is(has_function_privilege('anon','public.can_access_question(bigint)','EXECUTE'),FALSE,'anon cannot execute can_access_question');
SELECT extensions.is(has_function_privilege('anon','public.can_access_question_bank(bigint)','EXECUTE'),FALSE,'anon cannot execute can_access_question_bank');
SELECT extensions.is(has_function_privilege('anon','public.can_read_locked_session(uuid)','EXECUTE'),FALSE,'anon cannot execute can_read_locked_session');
SELECT extensions.is(has_function_privilege('anon','public.enforce_answer_finalization()','EXECUTE'),FALSE,'anon cannot execute enforce_answer_finalization');
SELECT extensions.is(has_function_privilege('anon','public.enforce_free_trial_session_quota()','EXECUTE'),FALSE,'anon cannot execute enforce_free_trial_session_quota');
SELECT extensions.is(has_function_privilege('anon','public.enforce_test_session_update_integrity()','EXECUTE'),FALSE,'anon cannot execute enforce_test_session_update_integrity');
SELECT extensions.is(has_function_privilege('anon','public.get_category_topic_counts(integer)','EXECUTE'),FALSE,'anon cannot execute get_category_topic_counts');
SELECT extensions.is(has_function_privilege('anon','public.get_category_topic_counts_json(bigint)','EXECUTE'),FALSE,'anon cannot execute bigint topic counts JSON');
SELECT extensions.is(has_function_privilege('anon','public.get_user_category_analytics(uuid)','EXECUTE'),FALSE,'anon cannot execute user category analytics');
SELECT extensions.is(has_function_privilege('anon','public.handle_new_user()','EXECUTE'),FALSE,'anon cannot execute signup trigger function directly');
SELECT extensions.is(has_function_privilege('anon','public.has_premium_question_bank_access(bigint)','EXECUTE'),FALSE,'anon cannot execute premium access helper');
SELECT extensions.is(has_function_privilege('anon','public.is_active_user()','EXECUTE'),FALSE,'anon cannot execute active-user helper');
SELECT extensions.is(has_function_privilege('anon','public.is_admin()','EXECUTE'),FALSE,'anon cannot execute admin helper');
SELECT extensions.is(has_function_privilege('anon','public.is_support_or_admin()','EXECUTE'),FALSE,'anon cannot execute support/admin helper');
SELECT extensions.is(has_function_privilege('anon','public.record_free_trial_session_usage()','EXECUTE'),FALSE,'anon cannot execute trial usage trigger function directly');
SELECT extensions.is(has_function_privilege('anon','public.rls_auto_enable()','EXECUTE'),FALSE,'anon cannot execute RLS auto-enable function');
SELECT extensions.is(has_function_privilege('anon','public.set_ip_block_actor()','EXECUTE'),FALSE,'anon cannot execute IP actor trigger function directly');
SELECT extensions.is(has_function_privilege('anon','public.validate_user_answer_relationships()','EXECUTE'),FALSE,'anon cannot execute answer relationship trigger directly');
SELECT extensions.is(has_function_privilege('anon','public.validate_user_question_write_access()','EXECUTE'),FALSE,'anon cannot execute question write trigger directly');

SELECT extensions.ok(
    has_function_privilege('authenticated','public.can_access_question_bank(bigint)','EXECUTE')
    AND has_function_privilege('authenticated','public.has_premium_question_bank_access(bigint)','EXECUTE')
    AND has_function_privilege('authenticated','public.is_active_user()','EXECUTE'),
    'signed-in access helpers preserve their authenticated execution contract'
);

INSERT INTO auth.users (
    instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    '39000000-0000-0000-0000-000000000001',
    'authenticated','authenticated','hardening-signup@test.local','',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
);

SELECT extensions.ok(
    EXISTS (SELECT 1 FROM public.profiles WHERE id='39000000-0000-0000-0000-000000000001'),
    'signup trigger still creates the profile after direct EXECUTE is revoked from anon'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','39000000-0000-0000-0000-000000000001',true);
SELECT extensions.is(public.is_active_user(),TRUE,'authenticated active-user helper still executes normally');

SELECT * FROM extensions.finish();
ROLLBACK;
