-- Optimize exam creation by selecting only the requested question-state candidates.
--
-- Previously create_exam_session() materialized get_user_question_states() for the
-- whole bank and only then filtered to new/incorrect/flagged/suspended/all.
-- This version preserves the same product semantics while using a direct query for
-- each selection mode and returning only the requested candidate ids.

CREATE OR REPLACE FUNCTION public.create_exam_session(
    p_user_id UUID,
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INTEGER,
    p_difficulties TEXT[],
    p_categories TEXT[],
    p_topics JSONB,
    p_question_selection TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    new_session_id UUID;
    selected_question_ids BIGINT[];
    selected_count INTEGER;
    effective_limit INTEGER;
    trial_question_limit INTEGER;
    bank_is_free_trial BOOLEAN;
    has_premium BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 70 THEN
        RAISE EXCEPTION 'Question limit must be between 1 and 70';
    END IF;

    IF p_session_type NOT IN (
        'standard', 'tutor', 'timed', 'fixed_timed', 'mock_exam', 'review', 'quick_champion'
    ) THEN
        RAISE EXCEPTION 'Invalid session type';
    END IF;

    IF p_question_selection NOT IN (
        'new_only', 'incorrect_only', 'all', 'flagged_only', 'suspended_only'
    ) THEN
        RAISE EXCEPTION 'Invalid question selection';
    END IF;

    IF p_topics IS NULL OR jsonb_typeof(p_topics) <> 'array' THEN
        RAISE EXCEPTION 'Topic filters must be a JSON array';
    END IF;

    SELECT qb.is_free_trial, qb.free_trial_question_limit
    INTO bank_is_free_trial, trial_question_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    -- has_premium_question_bank_access() already includes the active-user check.
    -- Trial access still needs an explicit active-user check when premium is false.
    has_premium := public.has_premium_question_bank_access(p_bank_id);

    IF NOT has_premium THEN
        IF NOT public.is_active_user() THEN
            RAISE EXCEPTION 'Account is inactive';
        END IF;

        IF NOT bank_is_free_trial THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    END IF;

    effective_limit := LEAST(
        p_limit,
        CASE WHEN has_premium THEN 70 ELSE trial_question_limit END
    );

    IF p_question_selection = 'all' THEN
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT
                q.id AS question_id,
                random() AS random_key
            FROM public.question_bank_questions qbq
            JOIN public.questions q ON q.id = qbq.question_id
            WHERE qbq.question_bank_id = p_bank_id
              AND (
                  COALESCE(cardinality(p_difficulties), 0) = 0
                  OR q.difficulty = ANY(p_difficulties)
              )
              AND (
                  (
                      COALESCE(cardinality(p_categories), 0) = 0
                      AND jsonb_array_length(p_topics) = 0
                  )
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) AS chosen;

    ELSIF p_question_selection = 'flagged_only' THEN
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT
                q.id AS question_id,
                random() AS random_key
            FROM public.user_question_flags uqf
            JOIN public.question_bank_questions qbq
              ON qbq.question_id = uqf.question_id
             AND qbq.question_bank_id = p_bank_id
            JOIN public.questions q ON q.id = uqf.question_id
            WHERE uqf.user_id = p_user_id
              AND (
                  COALESCE(cardinality(p_difficulties), 0) = 0
                  OR q.difficulty = ANY(p_difficulties)
              )
              AND (
                  (
                      COALESCE(cardinality(p_categories), 0) = 0
                      AND jsonb_array_length(p_topics) = 0
                  )
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) AS chosen;

    ELSIF p_question_selection = 'incorrect_only' THEN
        WITH finalized_latest AS (
            SELECT DISTINCT ON (ua.question_id)
                ua.question_id,
                ua.is_correct
            FROM public.user_answers ua
            JOIN public.test_sessions answer_session
              ON answer_session.id = ua.test_session_id
            JOIN public.question_bank_questions qbq
              ON qbq.question_id = ua.question_id
             AND qbq.question_bank_id = p_bank_id
            WHERE ua.user_id = p_user_id
              AND (
                  answer_session.is_completed = TRUE
                  OR answer_session.session_type IN ('standard', 'tutor')
              )
            ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
        )
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT
                q.id AS question_id,
                random() AS random_key
            FROM finalized_latest latest
            JOIN public.questions q ON q.id = latest.question_id
            WHERE latest.is_correct = FALSE
              AND (
                  COALESCE(cardinality(p_difficulties), 0) = 0
                  OR q.difficulty = ANY(p_difficulties)
              )
              AND (
                  (
                      COALESCE(cardinality(p_categories), 0) = 0
                      AND jsonb_array_length(p_topics) = 0
                  )
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) AS chosen;

    ELSIF p_question_selection = 'suspended_only' THEN
        WITH suspended_candidates AS (
            SELECT DISTINCT tsq.question_id
            FROM public.test_sessions ts
            JOIN public.test_session_questions tsq
              ON tsq.test_session_id = ts.id
            LEFT JOIN public.user_answers ua
              ON ua.test_session_id = ts.id
             AND ua.question_id = tsq.question_id
             AND ua.user_id = p_user_id
            WHERE ts.user_id = p_user_id
              AND ts.question_bank_id = p_bank_id
              AND ts.is_completed = FALSE
              AND ua.id IS NULL
        )
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT
                q.id AS question_id,
                random() AS random_key
            FROM suspended_candidates suspended
            JOIN public.question_bank_questions qbq
              ON qbq.question_id = suspended.question_id
             AND qbq.question_bank_id = p_bank_id
            JOIN public.questions q ON q.id = suspended.question_id
            WHERE (
                  COALESCE(cardinality(p_difficulties), 0) = 0
                  OR q.difficulty = ANY(p_difficulties)
              )
              AND (
                  (
                      COALESCE(cardinality(p_categories), 0) = 0
                      AND jsonb_array_length(p_topics) = 0
                  )
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) AS chosen;

    ELSE
        -- new_only: no finalized answer and not locked in another active block.
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT
                q.id AS question_id,
                random() AS random_key
            FROM public.question_bank_questions qbq
            JOIN public.questions q ON q.id = qbq.question_id
            WHERE qbq.question_bank_id = p_bank_id
              AND (
                  COALESCE(cardinality(p_difficulties), 0) = 0
                  OR q.difficulty = ANY(p_difficulties)
              )
              AND (
                  (
                      COALESCE(cardinality(p_categories), 0) = 0
                      AND jsonb_array_length(p_topics) = 0
                  )
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1
                      FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.user_answers ua
                  JOIN public.test_sessions answer_session
                    ON answer_session.id = ua.test_session_id
                  WHERE ua.user_id = p_user_id
                    AND ua.question_id = q.id
                    AND (
                        answer_session.is_completed = TRUE
                        OR answer_session.session_type IN ('standard', 'tutor')
                    )
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.test_session_questions tsq
                  JOIN public.test_sessions active_session
                    ON active_session.id = tsq.test_session_id
                  WHERE tsq.question_id = q.id
                    AND active_session.user_id = p_user_id
                    AND active_session.question_bank_id = p_bank_id
                    AND active_session.is_completed = FALSE
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) AS chosen;
    END IF;

    selected_count := COALESCE(cardinality(selected_question_ids), 0);
    IF selected_count = 0 THEN
        RAISE EXCEPTION 'No questions match the selected filters';
    END IF;

    INSERT INTO public.test_sessions (
        user_id,
        question_bank_id,
        session_type,
        categories,
        difficulty_filter,
        question_selection,
        topic_filters,
        total_questions,
        is_completed
    ) VALUES (
        p_user_id,
        p_bank_id,
        p_session_type,
        COALESCE(p_categories, ARRAY[]::TEXT[]),
        COALESCE(p_difficulties, ARRAY[]::TEXT[]),
        p_question_selection,
        p_topics,
        selected_count,
        FALSE
    )
    RETURNING id INTO new_session_id;

    INSERT INTO public.test_session_questions (
        test_session_id,
        question_id,
        sort_order
    )
    SELECT
        new_session_id,
        selected.question_id,
        selected.ordinality::INTEGER - 1
    FROM unnest(selected_question_ids) WITH ORDINALITY AS selected(question_id, ordinality);

    RETURN new_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
