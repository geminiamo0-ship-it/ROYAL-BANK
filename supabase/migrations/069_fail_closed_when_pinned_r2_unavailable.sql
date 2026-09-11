-- Operational fail-safe for immutable content pinning.
--
-- If the application/R2 feature flag is disabled or misconfigured while pinned
-- sessions still exist, the legacy full-content RPC names must not silently serve
-- mutable Postgres question/answer-key content. Legacy pre-065 sessions remain
-- supported. Content-free mutations/state actions remain usable.

CREATE OR REPLACE FUNCTION private.assert_exam_session_legacy_content(
    p_session_id uuid,
    p_require_completed boolean DEFAULT NULL
)
RETURNS public.test_sessions
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF p_require_completed IS TRUE AND NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF p_require_completed IS FALSE AND v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;
    IF v_session.content_release_id IS NOT NULL THEN
        RAISE EXCEPTION 'PINNED_CONTENT_REQUIRES_R2';
    END IF;

    RETURN v_session;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_exam_session_legacy_content(uuid, boolean)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_exam_session_window(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_session public.test_sessions;
    v_effective_count integer;
BEGIN
    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;
    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    v_session := private.assert_exam_session_legacy_content(p_session_id, FALSE);
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

    RETURN private.get_exam_session_window_core(
        p_session_id,
        p_start,
        v_effective_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_v3(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    PERFORM private.assert_exam_session_legacy_content(p_session_id, NULL);
    RETURN private.augment_exam_bootstrap_existing_release(
        public.get_exam_session_bootstrap_v2(p_session_id)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_question_feedback(
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
    v_correct_option_id bigint;
    v_explanation text;
    v_percentages jsonb;
BEGIN
    v_session := private.assert_exam_session_legacy_content(p_session_id, NULL);
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
        'is_correct', v_answer.is_correct,
        'correct_option_id', v_correct_option_id,
        'explanation_html', v_explanation,
        'option_percentages', v_percentages
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_training_feedback(
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
    v_correct_option_id bigint;
    v_explanation text;
    v_percentages jsonb;
BEGIN
    v_session := private.assert_exam_session_legacy_content(p_session_id, FALSE);
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
        'correct_option_id', v_correct_option_id,
        'explanation_html', v_explanation,
        'option_percentages', v_percentages
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_exam_answer_with_feedback_idempotent(
    p_request_id uuid,
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_answer jsonb;
    v_feedback jsonb;
    v_release_id text;
BEGIN
    -- Mutation remains available even if R2 is unavailable. Correctness is already
    -- computed from the pinned DB release snapshot by the answer trigger/core.
    v_answer := private.submit_exam_answer_idempotent_core(
        p_request_id,
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );

    SELECT ts.content_release_id
    INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_release_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'answer', v_answer,
            'feedback', NULL,
            'feedback_pending', TRUE
        );
    END IF;

    v_feedback := public.get_exam_question_feedback(p_session_id, p_question_id);
    RETURN jsonb_build_object('answer', v_answer, 'feedback', v_feedback);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_window(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
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
    v_payload jsonb;
BEGIN
    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;
    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    v_session := private.assert_exam_session_legacy_content(p_session_id, TRUE);
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
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap(p_session_id uuid)
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
    v_session := private.assert_exam_session_legacy_content(p_session_id, TRUE);
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
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_feedback(
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
    v_correct_option_id bigint;
    v_explanation text;
    v_percentages jsonb;
BEGIN
    v_session := private.assert_exam_session_legacy_content(p_session_id, TRUE);
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
$function$;

REVOKE ALL ON FUNCTION public.get_exam_session_window(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_question_feedback(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_training_feedback(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_exam_answer_with_feedback_idempotent(uuid, uuid, bigint, bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_window(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_exam_session_window(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_question_feedback(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_training_feedback(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback_idempotent(uuid, uuid, bigint, bigint, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION private.assert_exam_session_legacy_content(uuid, boolean) IS
    'Fail-closed guard: mutable/full content RPCs are available only to explicit legacy (unpinned) sessions.';
COMMENT ON FUNCTION public.submit_exam_answer_with_feedback_idempotent(uuid, uuid, bigint, bigint, integer) IS
    'Idempotent answer mutation remains available for pinned sessions when R2 is unavailable, but protected feedback never falls back to live content.';