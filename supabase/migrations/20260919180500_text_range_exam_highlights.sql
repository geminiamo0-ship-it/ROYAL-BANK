-- Allow text-range highlights alongside legacy vector annotation strokes.
-- Existing pencil/highlighter rows remain valid and require no data migration.

CREATE OR REPLACE FUNCTION public.is_valid_question_annotation_strokes(p_strokes jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stroke jsonb;
    v_point jsonb;
    v_tool text;
    v_width numeric;
    v_x numeric;
    v_y numeric;
    v_start numeric;
    v_end numeric;
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

        v_tool := COALESCE(v_stroke ->> 'tool', '');

        IF length(COALESCE(v_stroke ->> 'id', '')) < 1
           OR length(COALESCE(v_stroke ->> 'id', '')) > 80 THEN
            RETURN false;
        END IF;

        IF v_stroke ? 'color'
           AND COALESCE(v_stroke ->> 'color', '') NOT IN ('yellow', 'red', 'blue', 'green', 'purple') THEN
            RETURN false;
        END IF;

        IF v_tool = 'text-highlight' THEN
            IF COALESCE(jsonb_typeof(v_stroke -> 'start'), '') <> 'number'
               OR COALESCE(jsonb_typeof(v_stroke -> 'end'), '') <> 'number' THEN
                RETURN false;
            END IF;

            v_start := (v_stroke ->> 'start')::numeric;
            v_end := (v_stroke ->> 'end')::numeric;

            IF v_start <> trunc(v_start)
               OR v_end <> trunc(v_end)
               OR v_start < 0
               OR v_end <= v_start
               OR v_end > 250000 THEN
                RETURN false;
            END IF;

            IF v_stroke ? 'quote' THEN
                IF COALESCE(jsonb_typeof(v_stroke -> 'quote'), '') <> 'string'
                   OR length(v_stroke ->> 'quote') > 1000 THEN
                    RETURN false;
                END IF;
            END IF;

            CONTINUE;
        END IF;

        IF v_tool NOT IN ('pencil', 'highlighter') THEN
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

COMMENT ON FUNCTION public.is_valid_question_annotation_strokes(jsonb) IS
    'Validates legacy vector ink plus layout-neutral text-range highlights.';
