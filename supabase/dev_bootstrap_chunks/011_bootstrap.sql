CREATE OR REPLACE FUNCTION public.get_exam_session_window(
    p_session_id UUID,
    p_start INTEGER DEFAULT 0,
    p_count INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    session_row public.test_sessions;
    question_payload JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;

    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    SELECT *
    INTO session_row
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF session_row.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;

    IF NOT public.can_access_question_bank(session_row.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
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
            ORDER BY tsq.sort_order
        ),
        '[]'::jsonb
    )
    INTO question_payload
    FROM public.test_session_questions tsq
    JOIN public.questions q ON q.id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + p_count;

    RETURN question_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    TO authenticated;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap(
    p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    session_row public.test_sessions;
    reveal_correctness BOOLEAN;
    question_ids JSONB;
    answers_payload JSONB;
    flagged_payload JSONB;
    current_index INTEGER;
    first_question_payload JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT *
    INTO session_row
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF session_row.is_completed THEN
        RETURN jsonb_build_object(
            'status', 'completed',
            'session', jsonb_build_object(
                'id', session_row.id,
                'question_bank_id', session_row.question_bank_id,
                'session_type', session_row.session_type,
                'time_limit_minutes', session_row.time_limit_minutes,
                'total_questions', COALESCE(session_row.total_questions, 0),
                'is_completed', TRUE
            ),
            'question_ids', '[]'::jsonb,
            'questions', '[]'::jsonb,
            'answers', '[]'::jsonb,
            'flagged_question_ids', '[]'::jsonb,
            'current_index', 0
        );
    END IF;

    IF NOT public.can_access_question_bank(session_row.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(jsonb_agg(tsq.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO question_ids
    FROM public.test_session_questions tsq
    WHERE tsq.test_session_id = p_session_id;

    reveal_correctness := session_row.session_type IN ('standard', 'tutor');

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'question_id', ua.question_id,
                'selected_option_id', ua.selected_option_id,
                'is_correct', CASE WHEN reveal_correctness THEN ua.is_correct ELSE NULL END,
                'correct_option_id', CASE WHEN reveal_correctness THEN correct_option.id ELSE NULL END,
                'time_spent_seconds', ua.time_spent_seconds
            )
            ORDER BY ua.answered_at, ua.id
        ),
        '[]'::jsonb
    )
    INTO answers_payload
    FROM public.user_answers ua
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) correct_option ON TRUE
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid();

    SELECT COALESCE(jsonb_agg(uqf.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO flagged_payload
    FROM public.test_session_questions tsq
    JOIN public.user_question_flags uqf
      ON uqf.question_id = tsq.question_id
     AND uqf.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    SELECT COALESCE(
        MIN(tsq.sort_order) FILTER (WHERE ua.id IS NULL),
        GREATEST(COALESCE(session_row.total_questions, 1) - 1, 0)
    )
    INTO current_index
    FROM public.test_session_questions tsq
    LEFT JOIN public.user_answers ua
      ON ua.test_session_id = p_session_id
     AND ua.question_id = tsq.question_id
     AND ua.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    first_question_payload := public.get_exam_session_window(
        p_session_id,
        current_index,
        1
    );

    RETURN jsonb_build_object(
        'status', 'active',
        'session', jsonb_build_object(
            'id', session_row.id,
            'question_bank_id', session_row.question_bank_id,
            'session_type', session_row.session_type,
            'time_limit_minutes', session_row.time_limit_minutes,
            'total_questions', COALESCE(session_row.total_questions, 0),
            'is_completed', FALSE
        ),
        'question_ids', question_ids,
        'questions', first_question_payload,
        'answers', answers_payload,
        'flagged_question_ids', flagged_payload,
        'current_index', current_index
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap(UUID)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap(UUID)
    TO authenticated;
