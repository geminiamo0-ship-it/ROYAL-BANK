-- Lightweight exam RPCs for private R2 content hydration.
-- These preserve the existing authorization, disclosure accounting and feedback
-- rules while returning only the small fields that must remain in Postgres.

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
            jsonb_build_object('id', tsq.question_id)
            ORDER BY tsq.sort_order
        )
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = p_session_id
          AND tsq.sort_order >= p_start
          AND tsq.sort_order < p_start + v_effective_count
    ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_window_refs(
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
AS $function$
DECLARE
    v_session public.test_sessions;
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

    RETURN COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object('id', tsq.question_id)
            ORDER BY tsq.sort_order
        )
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = p_session_id
          AND tsq.sort_order >= p_start
          AND tsq.sort_order < p_start + p_count
    ), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_question_feedback_ref(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    session_row public.test_sessions;
    answer_row public.user_answers;
    correct_option_id bigint;
    percentages jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO session_row
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT public.can_access_question_bank(session_row.question_bank_id) THEN
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
    IF NOT EXISTS (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = auth.uid()
          AND d.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    SELECT * INTO answer_row
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
      AND ua.question_id = p_question_id;

    IF answer_row.id IS NULL THEN
        RAISE EXCEPTION 'Question has not been answered';
    END IF;
    IF NOT session_row.is_completed
       AND session_row.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Feedback is unavailable until End Block';
    END IF;

    SELECT o.id INTO correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    ) INTO percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', answer_row.selected_option_id,
        'is_correct', answer_row.is_correct,
        'correct_option_id', correct_option_id,
        'option_percentages', percentages
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_exam_answer_with_feedback_ref(
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    answer_payload jsonb;
    feedback_payload jsonb;
BEGIN
    answer_payload := public.submit_exam_answer(
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );

    feedback_payload := public.get_exam_question_feedback_ref(
        p_session_id,
        p_question_id
    );

    RETURN jsonb_build_object(
        'answer', answer_payload,
        'feedback', feedback_payload
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_ref(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    session_row public.test_sessions;
    reveal_correctness boolean;
    question_ids jsonb;
    answers_payload jsonb;
    flagged_payload jsonb;
    current_index integer;
    first_question_payload jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO session_row
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
    ) INTO answers_payload
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
    ) INTO current_index
    FROM public.test_session_questions tsq
    LEFT JOIN public.user_answers ua
      ON ua.test_session_id = p_session_id
     AND ua.question_id = tsq.question_id
     AND ua.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    first_question_payload := public.get_exam_session_window_refs(
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
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap_ref(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
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

    v_first_question := public.get_completed_exam_review_window_refs(p_session_id, 0, 1);

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
$function$;

REVOKE ALL ON FUNCTION public.get_exam_session_window_refs(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_window_refs(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_question_feedback_ref(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_exam_answer_with_feedback_ref(uuid, bigint, bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_ref(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap_ref(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_exam_session_window_refs(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window_refs(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_question_feedback_ref(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback_ref(uuid, bigint, bigint, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_ref(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap_ref(uuid) TO authenticated, service_role;
