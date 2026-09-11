-- Persistent per-user question annotations for the exam workspace.
-- Vector strokes only; no HTML or executable content is stored.

CREATE OR REPLACE FUNCTION public.is_valid_question_annotation_strokes(p_strokes jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stroke jsonb;
    v_point jsonb;
    v_width numeric;
    v_x numeric;
    v_y numeric;
    v_total_points integer := 0;
    v_point_count integer;
BEGIN
    IF p_strokes IS NULL OR jsonb_typeof(p_strokes) <> 'array' THEN
        RETURN false;
    END IF;

    IF jsonb_array_length(p_strokes) > 500 OR pg_column_size(p_strokes) > 262144 THEN
        RETURN false;
    END IF;

    FOR v_stroke IN SELECT value FROM jsonb_array_elements(p_strokes)
    LOOP
        IF jsonb_typeof(v_stroke) <> 'object' THEN
            RETURN false;
        END IF;

        IF COALESCE(v_stroke ->> 'tool', '') NOT IN ('pencil', 'highlighter') THEN
            RETURN false;
        END IF;

        IF length(COALESCE(v_stroke ->> 'id', '')) < 1
           OR length(COALESCE(v_stroke ->> 'id', '')) > 80 THEN
            RETURN false;
        END IF;

        IF v_stroke ? 'color'
           AND COALESCE(v_stroke ->> 'color', '') NOT IN ('yellow', 'red', 'blue', 'green', 'purple') THEN
            RETURN false;
        END IF;

        IF COALESCE(jsonb_typeof(v_stroke -> 'width'), '') <> 'number' THEN
            RETURN false;
        END IF;

        v_width := (v_stroke ->> 'width')::numeric;
        IF v_width < 0.5 OR v_width > 48 THEN
            RETURN false;
        END IF;

        IF COALESCE(jsonb_typeof(v_stroke -> 'points'), '') <> 'array' THEN
            RETURN false;
        END IF;

        v_point_count := jsonb_array_length(v_stroke -> 'points');
        IF v_point_count < 2 OR v_point_count > 2000 THEN
            RETURN false;
        END IF;

        v_total_points := v_total_points + v_point_count;
        IF v_total_points > 25000 THEN
            RETURN false;
        END IF;

        FOR v_point IN SELECT value FROM jsonb_array_elements(v_stroke -> 'points')
        LOOP
            IF COALESCE(jsonb_typeof(v_point), '') <> 'array'
               OR jsonb_array_length(v_point) <> 2
               OR COALESCE(jsonb_typeof(v_point -> 0), '') <> 'number'
               OR COALESCE(jsonb_typeof(v_point -> 1), '') <> 'number' THEN
                RETURN false;
            END IF;

            v_x := (v_point ->> 0)::numeric;
            v_y := (v_point ->> 1)::numeric;
            IF v_x < 0 OR v_x > 1 OR v_y < 0 OR v_y > 1 THEN
                RETURN false;
            END IF;
        END LOOP;
    END LOOP;

    RETURN true;
EXCEPTION
    WHEN others THEN
        RETURN false;
END;
$$;

CREATE TABLE IF NOT EXISTS public.question_annotations (
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    question_id bigint NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    surface text NOT NULL CHECK (surface IN ('stem', 'options', 'explanation')),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    strokes jsonb NOT NULL DEFAULT '[]'::jsonb,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, question_id, surface),
    CONSTRAINT question_annotations_valid_strokes
        CHECK (public.is_valid_question_annotation_strokes(strokes))
);

-- The PK covers user_id first, but question_id also needs a leading index for its FK
-- and for question-centric cleanup when a question is removed.
CREATE INDEX IF NOT EXISTS idx_question_annotations_question_id
    ON public.question_annotations(question_id);

ALTER TABLE public.question_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_annotations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS question_annotations_select_own ON public.question_annotations;
CREATE POLICY question_annotations_select_own
ON public.question_annotations
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS question_annotations_insert_own ON public.question_annotations;
CREATE POLICY question_annotations_insert_own
ON public.question_annotations
FOR INSERT
TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS question_annotations_update_own ON public.question_annotations;
CREATE POLICY question_annotations_update_own
ON public.question_annotations
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS question_annotations_delete_own ON public.question_annotations;
CREATE POLICY question_annotations_delete_own
ON public.question_annotations
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.question_annotations FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.question_annotations TO authenticated;
GRANT ALL ON TABLE public.question_annotations TO service_role;

REVOKE ALL ON FUNCTION public.is_valid_question_annotation_strokes(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_question_annotation_strokes(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_question_annotation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := now();
    IF tg_op = 'INSERT' THEN
        NEW.version := 1;
    ELSE
        NEW.version := OLD.version + 1;
        NEW.created_at := OLD.created_at;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_question_annotation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_question_annotation() TO service_role;

DROP TRIGGER IF EXISTS trg_touch_question_annotation ON public.question_annotations;
CREATE TRIGGER trg_touch_question_annotation
BEFORE INSERT OR UPDATE ON public.question_annotations
FOR EACH ROW EXECUTE FUNCTION public.touch_question_annotation();

CREATE OR REPLACE FUNCTION public.get_my_question_annotations(p_question_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
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
    FROM public.question_annotations qa
    WHERE qa.user_id = (SELECT auth.uid())
      AND qa.question_id = p_question_id
      AND public.can_access_question(p_question_id);
$$;

CREATE OR REPLACE FUNCTION public.save_my_question_annotation(
    p_question_id bigint,
    p_surface text,
    p_content_hash text,
    p_strokes jsonb,
    p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_current_version integer;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
    END IF;

    IF p_question_id IS NULL OR p_question_id <= 0 THEN
        RAISE EXCEPTION 'invalid_question_id' USING errcode = '22023';
    END IF;

    IF NOT public.can_access_question(p_question_id) THEN
        RAISE EXCEPTION 'question_access_denied' USING errcode = '42501';
    END IF;

    IF p_surface NOT IN ('stem', 'options', 'explanation') THEN
        RAISE EXCEPTION 'invalid_annotation_surface' USING errcode = '22023';
    END IF;

    IF p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid_annotation_content_hash' USING errcode = '22023';
    END IF;

    IF NOT public.is_valid_question_annotation_strokes(p_strokes) THEN
        RAISE EXCEPTION 'invalid_annotation_payload' USING errcode = '22023';
    END IF;

    SELECT qa.version
      INTO v_current_version
    FROM public.question_annotations qa
    WHERE qa.user_id = v_uid
      AND qa.question_id = p_question_id
      AND qa.surface = p_surface
    FOR UPDATE;

    IF found THEN
        IF p_expected_version IS NOT NULL AND p_expected_version <> v_current_version THEN
            RAISE EXCEPTION 'annotation_conflict' USING errcode = '40001';
        END IF;

        UPDATE public.question_annotations qa
        SET content_hash = p_content_hash,
            strokes = p_strokes
        WHERE qa.user_id = v_uid
          AND qa.question_id = p_question_id
          AND qa.surface = p_surface;
    ELSE
        IF p_expected_version IS NOT NULL AND p_expected_version <> 0 THEN
            RAISE EXCEPTION 'annotation_conflict' USING errcode = '40001';
        END IF;

        BEGIN
            INSERT INTO public.question_annotations (
                user_id,
                question_id,
                surface,
                content_hash,
                strokes
            ) VALUES (
                v_uid,
                p_question_id,
                p_surface,
                p_content_hash,
                p_strokes
            );
        EXCEPTION
            WHEN unique_violation THEN
                RAISE EXCEPTION 'annotation_conflict' USING errcode = '40001';
        END;
    END IF;

    SELECT jsonb_build_object(
        'surface', qa.surface,
        'content_hash', qa.content_hash,
        'strokes', qa.strokes,
        'version', qa.version,
        'updated_at', qa.updated_at
    )
      INTO v_result
    FROM public.question_annotations qa
    WHERE qa.user_id = v_uid
      AND qa.question_id = p_question_id
      AND qa.surface = p_surface;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_my_question_annotations(p_question_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_count integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'authentication_required' USING errcode = '28000';
    END IF;

    IF p_question_id IS NULL OR p_question_id <= 0 THEN
        RAISE EXCEPTION 'invalid_question_id' USING errcode = '22023';
    END IF;

    IF NOT public.can_access_question(p_question_id) THEN
        RAISE EXCEPTION 'question_access_denied' USING errcode = '42501';
    END IF;

    DELETE FROM public.question_annotations qa
    WHERE qa.user_id = v_uid
      AND qa.question_id = p_question_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_question_annotations(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_my_question_annotation(bigint, text, text, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_my_question_annotations(bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_my_question_annotations(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_my_question_annotation(bigint, text, text, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_my_question_annotations(bigint) TO authenticated, service_role;