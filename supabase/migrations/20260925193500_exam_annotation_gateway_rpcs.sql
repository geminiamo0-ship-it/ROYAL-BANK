-- Compatibility backend for exam annotations used by /api/exam.
-- The client already exposes annotationsGet / annotationsBatch / annotationsClear,
-- but these RPCs were never created in DEV/Production, causing PostgREST 404s.
--
-- Keep the boundary session-scoped and user-scoped. No cross-user annotation
-- access is possible, and every question must belong to the supplied session.

CREATE OR REPLACE FUNCTION public.edge_annotations_get(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_records jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
    END IF;

    IF p_session_id IS NULL OR p_question_id IS NULL OR p_question_id <= 0 THEN
        RAISE EXCEPTION 'invalid_annotation_request' USING errcode = '22023';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'inactive_user' USING errcode = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.test_sessions ts
        JOIN public.test_session_questions tsq
          ON tsq.test_session_id = ts.id
         AND tsq.question_id = p_question_id
        WHERE ts.id = p_session_id
          AND ts.user_id = v_uid
    ) THEN
        RAISE EXCEPTION 'question_not_in_user_session' USING errcode = '42501';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'surface', qa.surface,
                'content_hash', qa.content_hash,
                'strokes', qa.strokes,
                'version', qa.version,
                'updated_at', qa.updated_at
            )
            ORDER BY qa.surface
        ),
        '[]'::jsonb
    )
    INTO v_records
    FROM public.question_annotations qa
    WHERE qa.user_id = v_uid
      AND qa.question_id = p_question_id;

    RETURN jsonb_build_object(
        'hydrated', true,
        'records', v_records
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.edge_annotations_batch(
    p_session_id uuid,
    p_question_id bigint,
    p_updates jsonb,
    p_seed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_update jsonb;
    v_surface text;
    v_content_hash text;
    v_strokes jsonb;
    v_records jsonb;
    v_seen_surfaces text[] := ARRAY[]::text[];
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
    END IF;

    IF p_session_id IS NULL OR p_question_id IS NULL OR p_question_id <= 0 THEN
        RAISE EXCEPTION 'invalid_annotation_request' USING errcode = '22023';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'inactive_user' USING errcode = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.test_sessions ts
        JOIN public.test_session_questions tsq
          ON tsq.test_session_id = ts.id
         AND tsq.question_id = p_question_id
        WHERE ts.id = p_session_id
          AND ts.user_id = v_uid
    ) THEN
        RAISE EXCEPTION 'question_not_in_user_session' USING errcode = '42501';
    END IF;

    IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
        RAISE EXCEPTION 'invalid_annotation_updates' USING errcode = '22023';
    END IF;

    IF jsonb_array_length(p_updates) > 3 THEN
        RAISE EXCEPTION 'too_many_annotation_surfaces' USING errcode = '22023';
    END IF;

    IF jsonb_array_length(p_updates) = 0 AND COALESCE(p_seed, false) = false THEN
        RAISE EXCEPTION 'annotation_updates_required' USING errcode = '22023';
    END IF;

    FOR v_update IN
        SELECT value FROM jsonb_array_elements(p_updates)
    LOOP
        IF jsonb_typeof(v_update) <> 'object' THEN
            RAISE EXCEPTION 'invalid_annotation_update' USING errcode = '22023';
        END IF;

        v_surface := NULLIF(v_update->>'surface', '');
        v_content_hash := NULLIF(v_update->>'content_hash', '');
        v_strokes := v_update->'strokes';

        IF v_surface NOT IN ('stem', 'options', 'explanation') THEN
            RAISE EXCEPTION 'invalid_annotation_surface' USING errcode = '22023';
        END IF;

        IF v_surface = ANY(v_seen_surfaces) THEN
            RAISE EXCEPTION 'duplicate_annotation_surface' USING errcode = '22023';
        END IF;
        v_seen_surfaces := array_append(v_seen_surfaces, v_surface);

        IF v_content_hash IS NULL OR v_content_hash !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'invalid_annotation_content_hash' USING errcode = '22023';
        END IF;

        IF NOT public.is_valid_question_annotation_strokes(v_strokes) THEN
            RAISE EXCEPTION 'invalid_annotation_payload' USING errcode = '22023';
        END IF;

        IF COALESCE(p_seed, false) THEN
            INSERT INTO public.question_annotations (
                user_id,
                question_id,
                surface,
                content_hash,
                strokes
            )
            VALUES (
                v_uid,
                p_question_id,
                v_surface,
                v_content_hash,
                v_strokes
            )
            ON CONFLICT (user_id, question_id, surface) DO NOTHING;
        ELSE
            INSERT INTO public.question_annotations (
                user_id,
                question_id,
                surface,
                content_hash,
                strokes
            )
            VALUES (
                v_uid,
                p_question_id,
                v_surface,
                v_content_hash,
                v_strokes
            )
            ON CONFLICT (user_id, question_id, surface) DO UPDATE
            SET
                content_hash = EXCLUDED.content_hash,
                strokes = EXCLUDED.strokes;
        END IF;
    END LOOP;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'surface', qa.surface,
                'content_hash', qa.content_hash,
                'strokes', qa.strokes,
                'version', qa.version,
                'updated_at', qa.updated_at
            )
            ORDER BY qa.surface
        ),
        '[]'::jsonb
    )
    INTO v_records
    FROM public.question_annotations qa
    WHERE qa.user_id = v_uid
      AND qa.question_id = p_question_id;

    RETURN jsonb_build_object(
        'hydrated', true,
        'records', v_records
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.edge_annotations_clear(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
    END IF;

    IF p_session_id IS NULL OR p_question_id IS NULL OR p_question_id <= 0 THEN
        RAISE EXCEPTION 'invalid_annotation_request' USING errcode = '22023';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'inactive_user' USING errcode = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.test_sessions ts
        JOIN public.test_session_questions tsq
          ON tsq.test_session_id = ts.id
         AND tsq.question_id = p_question_id
        WHERE ts.id = p_session_id
          AND ts.user_id = v_uid
    ) THEN
        RAISE EXCEPTION 'question_not_in_user_session' USING errcode = '42501';
    END IF;

    DELETE FROM public.question_annotations qa
    WHERE qa.user_id = v_uid
      AND qa.question_id = p_question_id;

    RETURN jsonb_build_object(
        'hydrated', true,
        'records', '[]'::jsonb
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_annotations_get(uuid, bigint)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edge_annotations_batch(uuid, bigint, jsonb, boolean)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edge_annotations_clear(uuid, bigint)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.edge_annotations_get(uuid, bigint)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edge_annotations_batch(uuid, bigint, jsonb, boolean)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.edge_annotations_clear(uuid, bigint)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.edge_annotations_get(uuid, bigint) IS
    'Session-scoped read endpoint for exam annotations used by the exam gateway.';
COMMENT ON FUNCTION public.edge_annotations_batch(uuid, bigint, jsonb, boolean) IS
    'Session-scoped batched write endpoint for exam annotations; validates all annotation payloads.';
COMMENT ON FUNCTION public.edge_annotations_clear(uuid, bigint) IS
    'Session-scoped clear endpoint for exam annotations.';


NOTIFY pgrst, 'reload schema';
