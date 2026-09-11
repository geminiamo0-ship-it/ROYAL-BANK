-- Preload static feedback for Standard/Tutor question windows so Submit can reveal
-- feedback immediately from client memory while persistence continues in background.
-- Timed/fixed-timed sessions intentionally keep the existing no-feedback-before-End-Block behavior.

CREATE OR REPLACE FUNCTION public.get_exam_session_window_refs(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_session public.test_sessions;
    v_effective_count integer;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;
    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;
    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = v_user_id;

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;
    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    v_effective_count := private.authorize_and_record_question_window(
        v_user_id,
        v_session.question_bank_id,
        p_session_id,
        p_start,
        p_count
    );

    IF v_effective_count <= 0 THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(
            CASE
                WHEN v_session.session_type IN ('standard', 'tutor') THEN
                    jsonb_build_object(
                        'id', tsq.question_id,
                        'prefetched_feedback', jsonb_build_object(
                            'question_id', tsq.question_id,
                            'correct_option_id', correct_option.id,
                            'explanation_html', COALESCE(q.explanation_html, ''),
                            'option_percentages', COALESCE(percentages.value, '{}'::jsonb)
                        )
                    )
                ELSE jsonb_build_object('id', tsq.question_id)
            END
            ORDER BY tsq.sort_order
        )
        FROM public.test_session_questions tsq
        JOIN public.questions q ON q.id = tsq.question_id
        LEFT JOIN LATERAL (
            SELECT o.id
            FROM public.options o
            WHERE o.question_id = tsq.question_id
              AND o.is_correct = TRUE
            ORDER BY o.id
            LIMIT 1
        ) correct_option ON TRUE
        LEFT JOIN LATERAL (
            SELECT jsonb_object_agg(
                o.id::text,
                COALESCE(o.percentage, 0)
                ORDER BY o.option_order, o.id
            ) AS value
            FROM public.options o
            WHERE o.question_id = tsq.question_id
        ) percentages ON TRUE
        WHERE tsq.test_session_id = p_session_id
          AND tsq.sort_order >= p_start
          AND tsq.sort_order < p_start + v_effective_count
    ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_exam_session_window_refs(uuid, integer, integer)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_session_window_refs(uuid, integer, integer)
    TO authenticated, service_role;

-- Keep the non-R2 fallback equally responsive. The existing guarded window core still
-- owns question disclosure and safe question delivery; this wrapper only decorates the
-- already-authorized Standard/Tutor payload with static feedback.
CREATE OR REPLACE FUNCTION public.get_exam_session_window(
    p_session_id UUID,
    p_start INTEGER DEFAULT 0,
    p_count INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_session public.test_sessions;
    v_effective_count INTEGER;
    v_payload JSONB;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;

    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = v_user_id;

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;

    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    v_effective_count := private.authorize_and_record_question_window(
        v_user_id,
        v_session.question_bank_id,
        p_session_id,
        p_start,
        p_count
    );

    IF v_effective_count <= 0 THEN
        RETURN '[]'::jsonb;
    END IF;

    v_payload := private.get_exam_session_window_core(
        p_session_id,
        p_start,
        v_effective_count
    );

    IF v_session.session_type NOT IN ('standard', 'tutor') THEN
        RETURN v_payload;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            item.value || jsonb_build_object(
                'prefetched_feedback', jsonb_build_object(
                    'question_id', q.id,
                    'correct_option_id', correct_option.id,
                    'explanation_html', COALESCE(q.explanation_html, ''),
                    'option_percentages', COALESCE(percentages.value, '{}'::jsonb)
                )
            )
            ORDER BY item.ordinality
        ),
        '[]'::jsonb
    )
    INTO v_payload
    FROM jsonb_array_elements(v_payload) WITH ORDINALITY AS item(value, ordinality)
    JOIN public.questions q
      ON q.id = (item.value->>'id')::bigint
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE o.question_id = q.id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) correct_option ON TRUE
    LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(
            o.id::text,
            COALESCE(o.percentage, 0)
            ORDER BY o.option_order, o.id
        ) AS value
        FROM public.options o
        WHERE o.question_id = q.id
    ) percentages ON TRUE;

    RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    TO authenticated;

COMMENT ON FUNCTION public.get_exam_session_window_refs(uuid, integer, integer) IS
    'Returns authorized question refs and preloads static feedback only for Standard/Tutor sessions.';

COMMENT ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER) IS
    'Guarded question window; Standard/Tutor windows include static feedback for instant client reveal while timed modes remain concealed.';
