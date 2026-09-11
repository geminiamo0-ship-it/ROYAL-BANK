BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(16);

SELECT extensions.ok(
    (
        SELECT count(*) > 0
           AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'create_exam_session'
    ),
    'authenticated SQL compatibility access remains for legacy create_exam_session overloads'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'create_exam_session'
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    0,
    'anon cannot execute any legacy create_exam_session overload'
);

SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.get_exam_session_answers(uuid)', 'EXECUTE'),
    'authenticated SQL compatibility access remains for get_exam_session_answers'
);

SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.get_exam_session_answers(uuid)', 'EXECUTE'),
    'anon cannot execute legacy get_exam_session_answers RPC'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('create_exam_session', 'get_exam_session_answers')
          AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    ),
    0,
    'service_role retains execute on legacy exam maintenance functions'
);

SELECT extensions.ok(
    position(
        '''create_exam_session'',' IN (
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'api_hooks'
              AND p.proname = 'royal_exam_pre_request'
        )
    ) > 0,
    'legacy create_exam_session is protected by the exam pre-request gateway'
);

SELECT extensions.ok(
    position(
        '''get_exam_session_answers'',' IN (
            SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'api_hooks'
              AND p.proname = 'royal_exam_pre_request'
        )
    ) > 0,
    'legacy get_exam_session_answers is protected by the exam pre-request gateway'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.prorettype IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    0,
    'authenticated cannot execute SECURITY DEFINER trigger functions as RPCs'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND p.prorettype IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    0,
    'anon cannot execute SECURITY DEFINER trigger functions as RPCs'
);

SELECT extensions.ok(
    NOT has_table_privilege('anon', 'public.test_session_questions', 'SELECT'),
    'anon has no direct SELECT privilege on session question locks'
);

SELECT extensions.ok(
    has_table_privilege('authenticated', 'public.test_session_questions', 'SELECT'),
    'authenticated retains direct SELECT privilege on owned session question locks'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'test_session_questions'
          AND cmd = 'SELECT'
    ),
    1,
    'test_session_questions has one SELECT policy'
);

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'test_session_questions'
          AND policyname = 'Authenticated users read owned session questions'
          AND cmd = 'SELECT'
          AND 'authenticated' = ANY(roles)
    ),
    'canonical session-question SELECT policy is authenticated-only'
);

SELECT extensions.ok(
    NOT has_table_privilege('authenticated', 'public.questions', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.options', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.question_bank_questions', 'SELECT'),
    'authenticated still has no direct question-content SELECT privileges'
);

SELECT extensions.ok(
    NOT has_table_privilege('anon', 'public.questions', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.options', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.question_bank_questions', 'SELECT'),
    'anon still has no direct question-content SELECT privileges'
);

SELECT extensions.is(
    (
        SELECT count(*)::int
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('questions', 'options', 'question_bank_questions')
          AND policyname IN (
              'Admins have full access to questions',
              'Active users can read accessible questions',
              'Admins have full access to options',
              'Active users can read options for accessible questions',
              'Admins have full access to question_bank_questions',
              'Active users can read accessible bank mappings'
          )
    ),
    0,
    'dead browser policies are removed from RPC-only question content tables'
);

SELECT * FROM extensions.finish();
ROLLBACK;
