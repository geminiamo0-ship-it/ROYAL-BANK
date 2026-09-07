-- Close fresh-content bypasses discovered during the X security audit.
--
-- A session bootstrap intentionally exposes future question ids for client-side
-- navigation/progress, but it must never be possible to turn those ids into an
-- answer, feedback payload, or targeted flag before the question has actually been
-- disclosed through the guarded window path.
--
-- Existing answered history was backfilled into private.question_disclosures by
-- migration 012, so this preserves earned feedback/review for historical content.

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    option_is_correct BOOLEAN;
    trusted_timed_finalization BOOLEAN :=
        COALESCE(current_setting('app.timed_finalization', true), '') = 'on';
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Answer user does not match authenticated user';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = NEW.test_session_id
          AND ts.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    -- A selected answer is allowed only after the content has been disclosed at
    -- least once to this user. Timed End Block is the one intentional exception:
    -- it inserts NULL selections for unanswered questions so scoring/finality can
    -- complete without revealing those questions.
    IF NEW.selected_option_id IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = NEW.user_id
              AND d.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    IF NEW.selected_option_id IS NULL THEN
        IF NOT trusted_timed_finalization THEN
            RAISE EXCEPTION 'Submitted answer requires a selected option';
        END IF;
        NEW.is_correct := FALSE;
    ELSE
        SELECT o.is_correct INTO option_is_correct
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected option does not belong to question';
        END IF;

        NEW.is_correct := option_is_correct;
    END IF;

    IF to_regclass('public.test_session_questions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM public.test_session_questions tsq
            WHERE tsq.test_session_id = NEW.test_session_id
              AND tsq.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_exam_question_feedback(
    p_session_id UUID,
    p_question_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
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

    -- Timed completion can create an unanswered bookkeeping row for a question the
    -- user never saw. That row must not turn into an explanation/correct-answer
    -- oracle after End Block.
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

CREATE OR REPLACE FUNCTION public.get_exam_session_answers(p_session_id UUID)
RETURNS TABLE(
    question_id BIGINT,
    selected_option_id BIGINT,
    is_correct BOOLEAN,
    correct_option_id BIGINT,
    time_spent_seconds INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
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
        CASE
            WHEN reveal_correctness AND disclosed.question_id IS NOT NULL
                THEN correct_option.id
            ELSE NULL
        END,
        ua.time_spent_seconds
    FROM public.user_answers ua
    LEFT JOIN private.question_disclosures disclosed
      ON disclosed.user_id = ua.user_id
     AND disclosed.question_id = ua.question_id
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

CREATE OR REPLACE FUNCTION public.set_question_flag(
    p_question_id BIGINT,
    p_flagged BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_questions qbq
        WHERE qbq.question_id = p_question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    ) THEN
        RAISE EXCEPTION 'Question access denied';
    END IF;

    -- Flagging is a UI action on content the user has actually seen. Requiring a
    -- disclosure prevents enumerated question ids from being converted into a
    -- targeted flagged-only fresh-content selector. Unflagging remains allowed so a
    -- legacy/stale flag can always be removed.
    IF p_flagged
       AND NOT EXISTS (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = auth.uid()
              AND d.question_id = p_question_id
       ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    IF p_flagged THEN
        INSERT INTO public.user_question_flags (user_id, question_id)
        VALUES (auth.uid(), p_question_id)
        ON CONFLICT (user_id, question_id) DO NOTHING;
    ELSE
        DELETE FROM public.user_question_flags
        WHERE user_id = auth.uid()
          AND question_id = p_question_id;
    END IF;

    RETURN p_flagged;
END;
$$;
