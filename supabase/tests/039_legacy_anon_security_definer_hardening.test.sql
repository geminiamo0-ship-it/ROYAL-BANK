BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(4);

SELECT extensions.ok(
    NOT EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('public.audit_bank_access_change()'),
                ('public.audit_profile_access_change()'),
                ('public.can_access_question(bigint)'),
                ('public.can_access_question_bank(bigint)'),
                ('public.can_read_locked_session(uuid)'),
                ('public.enforce_answer_finalization()'),
                ('public.enforce_free_trial_session_quota()'),
                ('public.enforce_test_session_update_integrity()'),
                ('public.get_category_topic_counts(integer)'),
                ('public.get_category_topic_counts_json(bigint)'),
                ('public.get_user_category_analytics(uuid)'),
                ('public.handle_new_user()'),
                ('public.has_premium_question_bank_access(bigint)'),
                ('public.is_active_user()'),
                ('public.is_admin()'),
                ('public.is_support_or_admin()'),
                ('public.record_free_trial_session_usage()'),
                ('public.rls_auto_enable()'),
                ('public.set_ip_block_actor()'),
                ('public.validate_user_answer_relationships()'),
                ('public.validate_user_question_write_access()')
        ) AS target(signature)
        CROSS JOIN LATERAL (SELECT to_regprocedure(target.signature) AS oid) resolved
        WHERE resolved.oid IS NOT NULL
          AND has_function_privilege('anon', resolved.oid, 'EXECUTE')
    ),
    'anon cannot execute any existing legacy SECURITY DEFINER target'
);

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
    'signup trigger still creates the profile after direct anon EXECUTE is removed'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','39000000-0000-0000-0000-000000000001',true);
SELECT extensions.is(public.is_active_user(),TRUE,'authenticated active-user helper still executes normally');

SELECT * FROM extensions.finish();
ROLLBACK;
