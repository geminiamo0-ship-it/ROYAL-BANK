-- Restore disclosure-first authorization after the pinned-R2 fail-closed wrappers.
--
-- A locked question id is metadata, not a capability. Feedback RPCs must reject a
-- never-disclosed question before inspecting answer rows or reading any answer-key /
-- explanation content. This remains true after End Block, where timed finalization
-- may create NULL bookkeeping answers for questions the student never saw.

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

REVOKE ALL ON FUNCTION public.get_exam_question_feedback(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_question_feedback(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_exam_question_feedback(uuid, bigint) IS
    'Legacy full feedback requires prior disclosure before answer lookup/content access; pinned sessions fail closed to R2.';
COMMENT ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) IS
    'Legacy review feedback never reveals a never-disclosed question, including timed-finalization bookkeeping rows.';