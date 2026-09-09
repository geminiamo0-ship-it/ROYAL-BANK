-- Read-only review surface for completed exam sessions.
-- It is intentionally separate from the active-session window RPCs so review can never
-- mutate or weaken the sequencing/rate-limit rules used while a block is in progress.

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_window(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_session public.test_sessions;
    v_payload jsonb;
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

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF NOT public.can_read_locked_session(p_session_id) THEN
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
    ) INTO v_payload
    FROM public.test_session_questions tsq
    JOIN public.questions q ON q.id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + p_count;

    RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_session public.test_sessions;
    v_question_ids jsonb;
    v_answers jsonb;
    v_flags jsonb;
    v_first_question jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF NOT public.can_read_locked_session(p_session_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(jsonb_agg(tsq.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_question_ids
    FROM public.test_session_questions tsq
    WHERE tsq.test_session_id = p_session_id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'question_id', ua.question_id,
                'selected_option_id', ua.selected_option_id,
                'is_correct', ua.is_correct,
                'correct_option_id', correct_option.id,
                'time_spent_seconds', ua.time_spent_seconds
            )
            ORDER BY tsq.sort_order
        ),
        '[]'::jsonb
    ) INTO v_answers
    FROM public.test_session_questions tsq
    JOIN public.user_answers ua
      ON ua.test_session_id = p_session_id
     AND ua.user_id = auth.uid()
     AND ua.question_id = tsq.question_id
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) correct_option ON TRUE
    WHERE tsq.test_session_id = p_session_id;

    SELECT COALESCE(jsonb_agg(uqf.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_flags
    FROM public.test_session_questions tsq
    JOIN public.user_question_flags uqf
      ON uqf.question_id = tsq.question_id
     AND uqf.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    v_first_question := public.get_completed_exam_review_window(p_session_id, 0, 1);

    RETURN jsonb_build_object(
        'status', 'completed',
        'session', jsonb_build_object(
            'id', v_session.id,
            'question_bank_id', v_session.question_bank_id,
            'session_type', v_session.session_type,
            'time_limit_minutes', v_session.time_limit_minutes,
            'total_questions', COALESCE(v_session.total_questions, 0),
            'is_completed', TRUE
        ),
        'question_ids', v_question_ids,
        'questions', v_first_question,
        'answers', v_answers,
        'flagged_question_ids', v_flags,
        'current_index', 0
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_feedback(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_session public.test_sessions;
    v_answer public.user_answers;
    v_correct_option_id bigint;
    v_explanation text;
    v_percentages jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF NOT public.can_read_locked_session(p_session_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = p_session_id
          AND tsq.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'Question does not belong to session';
    END IF;

    SELECT * INTO v_answer
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
      AND ua.question_id = p_question_id
    ORDER BY ua.answered_at DESC, ua.id DESC
    LIMIT 1;

    SELECT o.id INTO v_correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT q.explanation_html INTO v_explanation
    FROM public.questions q
    WHERE q.id = p_question_id;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    ) INTO v_percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', v_answer.selected_option_id,
        'is_correct', COALESCE(v_answer.is_correct, FALSE),
        'correct_option_id', v_correct_option_id,
        'explanation_html', v_explanation,
        'option_percentages', v_percentages
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_completed_exam_review_window(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) TO authenticated;
