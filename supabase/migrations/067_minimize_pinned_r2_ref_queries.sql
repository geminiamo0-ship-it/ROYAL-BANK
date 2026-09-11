-- Load-test hardening for R2-backed exam reads.
--
-- Ref RPCs are an authorization/state boundary, not a second content source. For
-- pinned sessions, protected answer metadata and explanation content come from the
-- immutable release snapshot/R2 generation. Avoid scanning live questions/options
-- only to throw those values away during hydration.
--
-- Legacy sessions intentionally preserve their pre-pinning behavior. Bootstrap
-- answer rows use the live correct option only when content_release_id IS NULL;
-- pinned bootstrap rows use private.exam_content_release_answers.

CREATE OR REPLACE FUNCTION public.get_exam_question_feedback_ref_v2(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_answer public.user_answers;
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
    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
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

    SELECT * INTO v_answer
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
      AND ua.question_id = p_question_id;

    IF v_answer.id IS NULL THEN
        RAISE EXCEPTION 'Question has not been answered';
    END IF;
    IF NOT v_session.is_completed
       AND v_session.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Feedback is unavailable until End Block';
    END IF;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', v_answer.selected_option_id,
        'is_correct', v_answer.is_correct,
        'content_release_id', v_session.content_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_training_feedback_ref_v2(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
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
    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;
    IF v_session.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Training feedback is unavailable for this session type';
    END IF;
    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
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

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'content_release_id', v_session.content_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_feedback_ref_v2(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_answer public.user_answers;
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

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', v_answer.selected_option_id,
        'is_correct', COALESCE(v_answer.is_correct, FALSE),
        'content_release_id', v_session.content_release_id
    );
END;
$function$;

-- Active R2 bootstrap. Keep the same authorization/disclosure/current-index
-- semantics as migration 059, but resolve correct_option_id from the immutable DB
-- release snapshot for pinned sessions. The live options lookup is gated to legacy
-- sessions only.
CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_ref(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_reveal_correctness boolean;
    v_question_ids jsonb;
    v_answers jsonb;
    v_flags jsonb;
    v_current_index integer;
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

    IF v_session.is_completed THEN
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
            'question_ids', '[]'::jsonb,
            'questions', '[]'::jsonb,
            'answers', '[]'::jsonb,
            'flagged_question_ids', '[]'::jsonb,
            'current_index', 0
        );
    END IF;

    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(jsonb_agg(tsq.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_question_ids
    FROM public.test_session_questions tsq
    WHERE tsq.test_session_id = p_session_id;

    v_reveal_correctness := v_session.session_type IN ('standard', 'tutor');

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'question_id', ua.question_id,
                'selected_option_id', ua.selected_option_id,
                'is_correct', CASE WHEN v_reveal_correctness THEN ua.is_correct ELSE NULL END,
                'correct_option_id', CASE
                    WHEN NOT v_reveal_correctness THEN NULL
                    WHEN v_session.content_release_id IS NOT NULL THEN release_answer.correct_option_id
                    ELSE live_correct.id
                END,
                'time_spent_seconds', ua.time_spent_seconds
            )
            ORDER BY ua.answered_at, ua.id
        ),
        '[]'::jsonb
    ) INTO v_answers
    FROM public.user_answers ua
    LEFT JOIN private.exam_content_release_answers release_answer
      ON v_session.content_release_id IS NOT NULL
     AND release_answer.release_id = v_session.content_release_id
     AND release_answer.question_id = ua.question_id
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE v_session.content_release_id IS NULL
          AND o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) live_correct ON TRUE
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid();

    SELECT COALESCE(jsonb_agg(uqf.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_flags
    FROM public.test_session_questions tsq
    JOIN public.user_question_flags uqf
      ON uqf.question_id = tsq.question_id
     AND uqf.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    SELECT COALESCE(
        MIN(tsq.sort_order) FILTER (WHERE ua.id IS NULL),
        GREATEST(COALESCE(v_session.total_questions, 1) - 1, 0)
    ) INTO v_current_index
    FROM public.test_session_questions tsq
    LEFT JOIN public.user_answers ua
      ON ua.test_session_id = p_session_id
     AND ua.question_id = tsq.question_id
     AND ua.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    v_first_question := public.get_exam_session_window_refs(
        p_session_id,
        v_current_index,
        1
    );

    RETURN jsonb_build_object(
        'status', 'active',
        'session', jsonb_build_object(
            'id', v_session.id,
            'question_bank_id', v_session.question_bank_id,
            'session_type', v_session.session_type,
            'time_limit_minutes', v_session.time_limit_minutes,
            'total_questions', COALESCE(v_session.total_questions, 0),
            'is_completed', FALSE
        ),
        'question_ids', v_question_ids,
        'questions', v_first_question,
        'answers', v_answers,
        'flagged_question_ids', v_flags,
        'current_index', v_current_index
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap_ref(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
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
                'correct_option_id', CASE
                    WHEN v_session.content_release_id IS NOT NULL THEN release_answer.correct_option_id
                    ELSE live_correct.id
                END,
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
    LEFT JOIN private.exam_content_release_answers release_answer
      ON v_session.content_release_id IS NOT NULL
     AND release_answer.release_id = v_session.content_release_id
     AND release_answer.question_id = ua.question_id
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE v_session.content_release_id IS NULL
          AND o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) live_correct ON TRUE
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

REVOKE ALL ON FUNCTION public.get_exam_question_feedback_ref_v2(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_training_feedback_ref_v2(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_feedback_ref_v2(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_ref(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap_ref(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_exam_question_feedback_ref_v2(uuid, bigint)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_training_feedback_ref_v2(uuid, bigint)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback_ref_v2(uuid, bigint)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_ref(uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap_ref(uuid)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.get_exam_question_feedback_ref_v2(uuid, bigint) IS
    'Minimal R2 feedback authorization/state ref; protected content is hydrated from the pinned release.';
COMMENT ON FUNCTION public.get_exam_training_feedback_ref_v2(uuid, bigint) IS
    'Minimal R2 training-feedback authorization ref; protected content is hydrated from the pinned release.';
COMMENT ON FUNCTION public.get_completed_exam_review_feedback_ref_v2(uuid, bigint) IS
    'Minimal completed-review feedback state ref; protected content is hydrated from the pinned release.';
