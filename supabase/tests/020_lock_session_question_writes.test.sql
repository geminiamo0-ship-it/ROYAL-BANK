BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(9);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.test_session_questions', 'INSERT'),
    'authenticated cannot append questions to a locked session'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.test_session_questions', 'UPDATE'),
    'authenticated cannot rewrite locked session questions'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.test_session_questions', 'DELETE'),
    'authenticated cannot delete locked session questions directly'
);
SELECT extensions.ok(
    NOT has_table_privilege('anon', 'public.test_session_questions', 'INSERT'),
    'anon cannot append questions to a locked session'
);
SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.test_sessions', 'INSERT'),
    'authenticated session creation remains RPC-only'
);
SELECT extensions.ok(
    NOT has_table_privilege('anon', 'public.test_sessions', 'INSERT'),
    'anon cannot create sessions directly'
);
SELECT extensions.ok(
    has_table_privilege('authenticated', 'public.test_session_questions', 'SELECT'),
    'authenticated retains read access to owned locked session rows'
);
SELECT extensions.ok(
    has_table_privilege('authenticated', 'public.test_sessions', 'UPDATE'),
    'existing owner session update capability is unchanged'
);
SELECT extensions.ok(
    has_table_privilege('authenticated', 'public.test_sessions', 'DELETE'),
    'existing incomplete-session delete capability is unchanged'
);

SELECT * FROM extensions.finish();
ROLLBACK;
