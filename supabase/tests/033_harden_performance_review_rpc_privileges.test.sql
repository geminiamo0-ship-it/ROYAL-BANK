BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(10);

SELECT extensions.ok(
    NOT has_function_privilege('anon','public.get_question_bank_performance(bigint)','EXECUTE'),
    'anon cannot execute performance RPC'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon','public.get_my_bank_sessions(bigint,integer)','EXECUTE'),
    'anon cannot execute session history RPC'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon','public.get_completed_exam_review_bootstrap(uuid)','EXECUTE'),
    'anon cannot execute completed review bootstrap'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon','public.get_completed_exam_review_window(uuid,integer,integer)','EXECUTE'),
    'anon cannot execute completed review window'
);
SELECT extensions.ok(
    NOT has_function_privilege('anon','public.get_completed_exam_review_feedback(uuid,bigint)','EXECUTE'),
    'anon cannot execute completed review feedback'
);

SELECT extensions.ok(
    has_function_privilege('authenticated','public.get_question_bank_performance(bigint)','EXECUTE'),
    'authenticated can execute performance RPC'
);
SELECT extensions.ok(
    has_function_privilege('authenticated','public.get_my_bank_sessions(bigint,integer)','EXECUTE'),
    'authenticated can execute session history RPC'
);
SELECT extensions.ok(
    has_function_privilege('authenticated','public.get_completed_exam_review_bootstrap(uuid)','EXECUTE'),
    'authenticated can execute completed review bootstrap'
);
SELECT extensions.ok(
    has_function_privilege('authenticated','public.get_completed_exam_review_window(uuid,integer,integer)','EXECUTE'),
    'authenticated can execute completed review window'
);
SELECT extensions.ok(
    has_function_privilege('authenticated','public.get_completed_exam_review_feedback(uuid,bigint)','EXECUTE'),
    'authenticated can execute completed review feedback'
);

SELECT * FROM extensions.finish();
ROLLBACK;
