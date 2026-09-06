-- Keep answer keys, explanations and correctness behind server-enforced exam state.
-- Active mutable sessions (Timed and other non-Standard/Tutor modes) must never
-- reveal correctness before End Block.

-- Browser-facing table reads may fetch only non-sensitive question/option fields.
REVOKE SELECT ON TABLE public.questions FROM anon, authenticated;
GRANT SELECT (
    id,
    main_id,
    text_html,
    category,
    topic,
    concept_id,
    notes_id,
    difficulty,
    source,
    pm_question_id,
    created_at
) ON TABLE public.questions TO authenticated;

REVOKE SELECT ON TABLE public.options FROM anon, authenticated;
GRANT SELECT (
    id,
    question_id,
    text_html,
    option_order
) ON TABLE public.options TO authenticated;

-- Users may resume their own selections, but correctness remains gated by RPCs.
REVOKE SELECT ON TABLE public.user_answers FROM anon, authenticated;
GRANT SELECT (
    id,
    test_session_id,
    user_id,
    question_id,
    selected_option_id,
    is_flagged,
    time_spent_seconds,
    answered_at
) ON TABLE public.user_answers TO authenticated;

-- Recreate submit_exam_answer with a sanitized JSON result. Standard/Tutor answers
-- are final on submit and may reveal whether the submitted option was correct.
-- Mutable active modes return is_correct = null until the session is completed.
DROP FUNCTION IF EXISTS public.submit_exam_answer(UUID, BIGINT, BIGINT, INT);

CREATE FUNCTION public.submit_exam_answer(
    p_session_id UUID,
    p_question_id BIGINT,
    p_selected_option_id BIGINT,
    p_time_spent_seconds INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    mode TEXT;
    completed BOOLEAN;
    bank_id BIGINT;
    result public.user_answers;
    reveal_correctness BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_time_spent_seconds < 0 THEN
        RAISE EXCEPTION 'time_spent_seconds cannot be negative';
    END IF;

    SELECT ts.session_type, ts.is_completed, ts.question_bank_id
    INTO mode, completed, bank_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF NOT FOUND OR completed THEN
        RAISE EXCEPTION 'Active session not found';
    END IF;

    IF NOT public.can_access_question_bank(bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF mode IN ('standard', 'tutor') THEN
        INSERT INTO public.user_answers (
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        RETURNING * INTO result;
    ELSE
        INSERT INTO public.user_answers (
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        ON CONFLICT (test_session_id, question_id)
        DO UPDATE SET
            selected_option_id = EXCLUDED.selected_option_id,
            time_spent_seconds = EXCLUDED.time_spent_seconds
        RETURNING * INTO result;
    END IF;

    reveal_correctness := mode IN ('standard', 'tutor');

    RETURN jsonb_build_object(
        'question_id', result.question_id,
        'selected_option_id', result.selected_option_id,
        'time_spent_seconds', result.time_spent_seconds,
        'is_correct', CASE WHEN reveal_correctness THEN result.is_correct ELSE NULL END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam_answer(UUID, BIGINT, BIGINT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_exam_answer(UUID, BIGINT, BIGINT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer(UUID, BIGINT, BIGINT, INT) TO authenticated;

-- Safe answer-state payload for resuming a session. Correctness/correct option are
-- exposed only when answers are already final (Standard/Tutor) or the block ended.
CREATE OR REPLACE FUNCTION public.get_exam_session_answers(p_session_id UUID)
RETURNS TABLE (
    question_id BIGINT,
    selected_option_id BIGINT,
    is_correct BOOLEAN,
    correct_option_id BIGINT,
    time_spent_seconds INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    session_row public.test_sessions;
    reveal_correctness BOOLEAN;
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

    reveal_correctness := session_row.is_completed
        OR session_row.session_type IN ('standard', 'tutor');

    RETURN QUERY
    SELECT
        ua.question_id,
        ua.selected_option_id,
        CASE WHEN reveal_correctness THEN ua.is_correct ELSE NULL END,
        CASE WHEN reveal_correctness THEN correct_option.id ELSE NULL END,
        ua.time_spent_seconds
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
      AND ua.user_id = auth.uid()
    ORDER BY ua.answered_at, ua.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_session_answers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_exam_session_answers(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exam_session_answers(UUID) TO authenticated;

-- Feedback is available immediately for final Standard/Tutor submissions, or for
-- any mode after End Block. Active mutable sessions receive no answer key.
CREATE OR REPLACE FUNCTION public.get_exam_question_feedback(
    p_session_id UUID,
    p_question_id BIGINT
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
    answer_row public.user_answers;
    correct_option_id BIGINT;
    explanation TEXT;
    percentages JSONB;
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

    SELECT q.explanation_html INTO explanation
    FROM public.questions q
    WHERE q.id = p_question_id;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    )
    INTO percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', answer_row.selected_option_id,
        'is_correct', answer_row.is_correct,
        'correct_option_id', correct_option_id,
        'explanation_html', explanation,
        'option_percentages', percentages
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_question_feedback(UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_exam_question_feedback(UUID, BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exam_question_feedback(UUID, BIGINT) TO authenticated;

-- Canonical question state uses only finalized answers. Standard/Tutor submissions
-- finalize immediately; all mutable modes finalize only when their session ends.
CREATE OR REPLACE FUNCTION public.get_user_question_states(p_bank_id BIGINT)
RETURNS TABLE (
    question_id BIGINT,
    answer_state TEXT,
    is_suspended BOOLEAN,
    is_flagged BOOLEAN,
    is_new BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    RETURN QUERY
    WITH bank_questions AS (
        SELECT qbq.question_id
        FROM public.question_bank_questions qbq
        WHERE qbq.question_bank_id = p_bank_id
    ),
    finalized_latest AS (
        SELECT DISTINCT ON (ua.question_id)
            ua.question_id,
            ua.is_correct
        FROM public.user_answers ua
        JOIN public.test_sessions answer_session
          ON answer_session.id = ua.test_session_id
        WHERE ua.user_id = auth.uid()
          AND (
              answer_session.is_completed = TRUE
              OR answer_session.session_type IN ('standard', 'tutor')
          )
        ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
    ),
    suspended AS (
        SELECT DISTINCT tsq.question_id
        FROM public.test_session_questions tsq
        JOIN public.test_sessions ts ON ts.id = tsq.test_session_id
        LEFT JOIN public.user_answers ua
          ON ua.test_session_id = ts.id
         AND ua.question_id = tsq.question_id
         AND ua.user_id = auth.uid()
        WHERE ts.user_id = auth.uid()
          AND ts.question_bank_id = p_bank_id
          AND ts.is_completed = FALSE
          AND ua.id IS NULL
    ),
    active_locked AS (
        SELECT DISTINCT tsq.question_id
        FROM public.test_session_questions tsq
        JOIN public.test_sessions ts ON ts.id = tsq.test_session_id
        WHERE ts.user_id = auth.uid()
          AND ts.question_bank_id = p_bank_id
          AND ts.is_completed = FALSE
    ),
    flags AS (
        SELECT uqf.question_id
        FROM public.user_question_flags uqf
        WHERE uqf.user_id = auth.uid()
    )
    SELECT
        bq.question_id,
        CASE
            WHEN finalized_latest.question_id IS NULL THEN NULL
            WHEN finalized_latest.is_correct THEN 'correct'
            ELSE 'incorrect'
        END,
        suspended.question_id IS NOT NULL,
        flags.question_id IS NOT NULL,
        finalized_latest.question_id IS NULL AND active_locked.question_id IS NULL
    FROM bank_questions bq
    LEFT JOIN finalized_latest ON finalized_latest.question_id = bq.question_id
    LEFT JOIN suspended ON suspended.question_id = bq.question_id
    LEFT JOIN active_locked ON active_locked.question_id = bq.question_id
    LEFT JOIN flags ON flags.question_id = bq.question_id;
END;
$$;

-- Analytics must follow the same finalized-answer rule so aggregate accuracy cannot
-- be abused as a correctness oracle during an active mutable block.
CREATE OR REPLACE FUNCTION public.get_user_category_analytics(p_user_id UUID)
RETURNS TABLE (
    category TEXT,
    total_answered BIGINT,
    correct_count BIGINT,
    accuracy_percentage NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF auth.uid() <> p_user_id AND NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    WITH latest AS (
        SELECT DISTINCT ON (ua.question_id)
            ua.question_id,
            ua.is_correct
        FROM public.user_answers ua
        JOIN public.test_sessions answer_session
          ON answer_session.id = ua.test_session_id
        WHERE ua.user_id = p_user_id
          AND (
              answer_session.is_completed = TRUE
              OR answer_session.session_type IN ('standard', 'tutor')
          )
        ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
    )
    SELECT
        q.category,
        COUNT(*) AS total_answered,
        COUNT(*) FILTER (WHERE latest.is_correct) AS correct_count,
        ROUND(
            COUNT(*) FILTER (WHERE latest.is_correct)::NUMERIC
            / NULLIF(COUNT(*), 0) * 100,
            1
        ) AS accuracy_percentage
    FROM latest
    JOIN public.questions q ON q.id = latest.question_id
    GROUP BY q.category
    ORDER BY total_answered DESC;
END;
$$;

COMMENT ON FUNCTION public.get_exam_question_feedback(UUID, BIGINT) IS
'Returns answer key, explanation and option percentages only after a Standard/Tutor submission is final or after End Block for mutable modes.';
