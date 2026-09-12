-- Keep R2-backed Create lightweight: PostgreSQL should authorize and persist Q1,
-- but it should not assemble question/options content that the gateway immediately
-- replaces from the pinned immutable R2 release.
--
-- Legacy/non-R2 Create keeps the existing full Q1 payload unchanged. The R2 v3
-- wrapper enables a transaction-local ref mode before entering the existing
-- idempotent Create path. That means new idempotency rows store only `{id}` for Q1,
-- while historical idempotency rows containing full Q1 remain replay-compatible and
-- are normalized to the same ref shape before release pinning/R2 hydration.
--
-- Security semantics are unchanged: both fresh post-insert auth/access boundaries,
-- disclosure accounting, quotas, ordering, and the idempotency advisory lock remain
-- in their existing locations.

CREATE OR REPLACE FUNCTION private.exam_bootstrap_questions_to_refs(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    v_questions jsonb;
    v_first jsonb;
BEGIN
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RETURN p_payload;
    END IF;

    v_questions := p_payload->'questions';
    IF v_questions IS NULL OR jsonb_typeof(v_questions) <> 'array'
       OR jsonb_array_length(v_questions) = 0 THEN
        RETURN p_payload;
    END IF;

    v_first := v_questions->0;
    IF jsonb_typeof(v_first) <> 'object'
       OR jsonb_typeof(v_first->'id') <> 'number' THEN
        RAISE EXCEPTION 'INVALID_EXAM_BOOTSTRAP_REF';
    END IF;

    RETURN jsonb_set(
        p_payload,
        '{questions}',
        jsonb_build_array(jsonb_build_object('id', v_first->'id')),
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.exam_bootstrap_questions_to_refs(jsonb)
    FROM PUBLIC, anon, authenticated;

-- Patch only the Q1 materialization block in the current core. Fail closed if the
-- expected source shape changed, rather than silently replacing the wrong code.
DO $migration$
DECLARE
    v_def text;
    v_old text := $old$
    -- Build only Q1 from the selected id already in memory. The payload is
    -- intentionally answer-safe and matches get_exam_session_window().
    SELECT COALESCE((
        SELECT jsonb_build_array(
            jsonb_build_object(
                'id', q.id,
                'text_html', q.text_html,
                'category', q.category,
                'topic', q.topic,
                'difficulty', COALESCE(q.difficulty, '1'),
                'notes_id', q.notes_id,
                'concept_id', q.concept_id,
                'options', COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', o.id,
                            'question_id', o.question_id,
                            'text_html', o.text_html,
                            'option_order', o.option_order
                        )
                        ORDER BY o.option_order, o.id
                    )
                    FROM public.options o
                    WHERE o.question_id = q.id
                ), '[]'::jsonb)
            )
        )
        FROM public.questions q
        WHERE q.id = selected_question_ids[1]
    ), '[]'::jsonb)
    INTO first_question_payload;
$old$;
    v_new text := $new$
    -- R2 Create only needs a stable question reference here. The gateway hydrates
    -- the exact pinned release before responding to the browser. Legacy Create keeps
    -- the historical full-content Q1 payload below.
    IF current_setting('royal.exam_r2_ref_mode', true) = 'on' THEN
        first_question_payload := jsonb_build_array(
            jsonb_build_object('id', selected_question_ids[1])
        );
    ELSE
        SELECT COALESCE((
            SELECT jsonb_build_array(
                jsonb_build_object(
                    'id', q.id,
                    'text_html', q.text_html,
                    'category', q.category,
                    'topic', q.topic,
                    'difficulty', COALESCE(q.difficulty, '1'),
                    'notes_id', q.notes_id,
                    'concept_id', q.concept_id,
                    'options', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'id', o.id,
                                'question_id', o.question_id,
                                'text_html', o.text_html,
                                'option_order', o.option_order
                            )
                            ORDER BY o.option_order, o.id
                        )
                        FROM public.options o
                        WHERE o.question_id = q.id
                    ), '[]'::jsonb)
                )
            )
            FROM public.questions q
            WHERE q.id = selected_question_ids[1]
        ), '[]'::jsonb)
        INTO first_question_payload;
    END IF;
$new$;
BEGIN
    SELECT pg_get_functiondef(
        'private.create_exam_session_bootstrap_core(bigint,text,integer,text[],text[],jsonb,text)'::regprocedure
    ) INTO v_def;

    IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'CREATE_BOOTSTRAP_CORE_Q1_BLOCK_CHANGED';
    END IF;

    -- The target block must occur exactly once.
    IF position(v_old IN substr(v_def, position(v_old IN v_def) + length(v_old))) > 0 THEN
        RAISE EXCEPTION 'CREATE_BOOTSTRAP_CORE_Q1_BLOCK_AMBIGUOUS';
    END IF;

    v_def := replace(v_def, v_old, v_new);
    EXECUTE v_def;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.create_exam_session_bootstrap_idempotent_v3(
    p_request_id uuid,
    p_bank_id bigint,
    p_session_type text,
    p_limit integer,
    p_difficulties text[] DEFAULT ARRAY[]::text[],
    p_categories text[] DEFAULT ARRAY[]::text[],
    p_topics jsonb DEFAULT '[]'::jsonb,
    p_question_selection text DEFAULT 'new_only'::text,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_payload jsonb;
BEGIN
    -- This flag is transaction-local and only makes the response less privileged:
    -- the Create core returns `{id}` instead of live question/options content.
    PERFORM set_config('royal.exam_r2_ref_mode', 'on', true);

    v_payload := public.create_exam_session_bootstrap_idempotent_v2(
        p_request_id,
        p_bank_id,
        p_session_type,
        p_limit,
        p_difficulties,
        p_categories,
        p_topics,
        p_question_selection
    );

    -- Historical idempotency records may contain full Q1. Normalize them so old and
    -- new request IDs share the exact R2 ref contract without rewriting stored rows.
    v_payload := private.exam_bootstrap_questions_to_refs(v_payload);

    RETURN private.augment_exam_bootstrap_release(
        v_payload,
        p_content_release_id
    );
END;
$function$;

COMMENT ON FUNCTION private.exam_bootstrap_questions_to_refs(jsonb) IS
    'Normalizes a bootstrap Q1 payload to an id-only R2 question reference while preserving all session/state fields.';

NOTIFY pgrst, 'reload schema';
