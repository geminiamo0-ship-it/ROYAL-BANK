BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(13);

SELECT extensions.ok(
    to_regclass('public.question_annotations') IS NOT NULL,
    'question annotations table exists'
);

SELECT extensions.ok(
    (
        SELECT c.relrowsecurity AND c.relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'question_annotations'
    ),
    'question annotations enforce RLS'
);

SELECT extensions.ok(
    NOT has_table_privilege('anon', 'public.question_annotations', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.question_annotations', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.question_annotations', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.question_annotations', 'DELETE'),
    'anon has no question annotation table privileges'
);

SELECT extensions.ok(
    has_table_privilege('authenticated', 'public.question_annotations', 'SELECT')
    AND has_table_privilege('authenticated', 'public.question_annotations', 'INSERT')
    AND has_table_privilege('authenticated', 'public.question_annotations', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.question_annotations', 'DELETE'),
    'authenticated users can manage rows subject to RLS'
);

SELECT extensions.ok(
    NOT has_function_privilege('anon', 'public.get_my_question_annotations(bigint)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.save_my_question_annotation(bigint,text,text,jsonb,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.clear_my_question_annotations(bigint)', 'EXECUTE'),
    'anon cannot execute annotation RPCs'
);

SELECT extensions.ok(
    has_function_privilege('authenticated', 'public.get_my_question_annotations(bigint)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.save_my_question_annotation(bigint,text,text,jsonb,integer)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.clear_my_question_annotations(bigint)', 'EXECUTE'),
    'authenticated can execute annotation RPCs'
);

SELECT extensions.ok(
    has_function_privilege('service_role', 'public.get_my_question_annotations(bigint)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.save_my_question_annotation(bigint,text,text,jsonb,integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.clear_my_question_annotations(bigint)', 'EXECUTE'),
    'service role can execute annotation RPCs'
);

SELECT extensions.ok(
    public.is_valid_question_annotation_strokes(
        '[{"id":"legacy","tool":"pencil","width":2.5,"points":[[0.1,0.1],[0.2,0.2]]}]'::jsonb
    ),
    'legacy strokes without color remain valid'
);

SELECT extensions.ok(
    public.is_valid_question_annotation_strokes(
        '[{"id":"colored","tool":"highlighter","color":"blue","width":16,"points":[[0.1,0.1],[0.2,0.2]]}]'::jsonb
    ),
    'supported annotation colors are valid'
);

SELECT extensions.ok(
    NOT public.is_valid_question_annotation_strokes(
        '[{"id":"bad-color","tool":"pencil","color":"orange","width":2.5,"points":[[0.1,0.1],[0.2,0.2]]}]'::jsonb
    ),
    'unsupported annotation colors are rejected'
);

SELECT extensions.ok(
    NOT public.is_valid_question_annotation_strokes(
        '[{"id":"missing-width","tool":"pencil","points":[[0.1,0.1],[0.2,0.2]]}]'::jsonb
    ),
    'missing stroke width is rejected'
);

SELECT extensions.ok(
    EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = (i.indkey::smallint[])[0]
        WHERE n.nspname = 'public'
          AND t.relname = 'question_annotations'
          AND i.indisvalid
          AND a.attname = 'question_id'
    ),
    'question annotation question_id foreign key has a leading index'
);

SELECT extensions.ok(
    position(
        'can_access_question'
        in pg_get_functiondef('public.save_my_question_annotation(bigint,text,text,jsonb,integer)'::regprocedure)
    ) > 0,
    'annotation saves enforce question entitlement'
);

SELECT * FROM extensions.finish();
ROLLBACK;