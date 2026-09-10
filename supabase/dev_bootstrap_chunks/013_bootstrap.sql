-- Inline the response for a newly-created exam session.
--
-- Security boundary:
-- - Keep all existing auth/access checks unchanged.
-- - Keep all test_sessions triggers unchanged, including trial advisory locking,
--   quota enforcement, and usage-ledger recording.
-- - Preserve the fresh post-insert active/access checks that previously occurred
--   inside get_exam_session_bootstrap() and get_exam_session_window(). Under
--   READ COMMITTED those checks can observe a suspension/revocation that happens
--   after the earlier statement, so removing them would change security semantics.
-- - Do not trust any client/GUC/cache authorization state.
-- - Only remove read-after-write work whose values are already known inside this
--   function after a successful insert.
-- - Never expose explanation_html, options.is_correct, option percentages, or a
--   correct option id for unanswered questions.

CREATE OR REPLACE FUNCTION public.create_exam_session_bootstrap(
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INTEGER,
    p_difficulties TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_topics JSONB DEFAULT '[]'::JSONB,
    p_question_selection TEXT DEFAULT 'new_only'::TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    new_session public.test_sessions;
    selected_question_ids BIGINT[];
    selected_count INTEGER;
    effective_limit INTEGER;
    trial_question_limit INTEGER;
    bank_is_free_trial BOOLEAN;
    has_premium BOOLEAN;
    selection_pivot DOUBLE PRECISION := random();
    first_question_payload JSONB;
    flagged_payload JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
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
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.segment, chosen.shuffle_key, chosen.question_id)
        INTO selected_question_ids
        FROM (
            SELECT *
            FROM (
                (
                    SELECT
                        q.id AS question_id,
                        qbq.shuffle_key,
                        0 AS segment
                    FROM public.question_bank_questions qbq
                    JOIN public.questions q ON q.id = qbq.question_id
                    WHERE qbq.question_bank_id = p_bank_id
                      AND qbq.shuffle_key >= selection_pivot
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
                    ORDER BY qbq.shuffle_key, qbq.question_id
                    LIMIT effective_limit
                )
                UNION ALL
                (
                    SELECT
                        q.id AS question_id,
                        qbq.shuffle_key,
                        1 AS segment
                    FROM public.question_bank_questions qbq
                    JOIN public.questions q ON q.id = qbq.question_id
                    WHERE qbq.question_bank_id = p_bank_id
                      AND qbq.shuffle_key < selection_pivot
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
                    ORDER BY qbq.shuffle_key, qbq.question_id
                    LIMIT effective_limit
                )
            ) ring_candidates
            ORDER BY segment, shuffle_key, question_id
            LIMIT effective_limit
        ) chosen;

    ELSIF p_question_selection = 'flagged_only' THEN
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT q.id AS question_id, random() AS random_key
            FROM public.user_question_flags uqf
            JOIN public.question_bank_questions qbq
              ON qbq.question_id = uqf.question_id
             AND qbq.question_bank_id = p_bank_id
            JOIN public.questions q ON q.id = uqf.question_id
            WHERE uqf.user_id = v_user_id
              AND (COALESCE(cardinality(p_difficulties), 0) = 0 OR q.difficulty = ANY(p_difficulties))
              AND (
                  (COALESCE(cardinality(p_categories), 0) = 0 AND jsonb_array_length(p_topics) = 0)
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1 FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) chosen;

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
            WHERE ua.user_id = v_user_id
              AND (
                  answer_session.is_completed = TRUE
                  OR answer_session.session_type IN ('standard', 'tutor')
              )
            ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
        )
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT q.id AS question_id, random() AS random_key
            FROM finalized_latest latest
            JOIN public.questions q ON q.id = latest.question_id
            WHERE latest.is_correct = FALSE
              AND (COALESCE(cardinality(p_difficulties), 0) = 0 OR q.difficulty = ANY(p_difficulties))
              AND (
                  (COALESCE(cardinality(p_categories), 0) = 0 AND jsonb_array_length(p_topics) = 0)
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1 FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) chosen;

    ELSIF p_question_selection = 'suspended_only' THEN
        WITH suspended_candidates AS (
            SELECT DISTINCT tsq.question_id
            FROM public.test_sessions ts
            JOIN public.test_session_questions tsq ON tsq.test_session_id = ts.id
            LEFT JOIN public.user_answers ua
              ON ua.test_session_id = ts.id
             AND ua.question_id = tsq.question_id
             AND ua.user_id = v_user_id
            WHERE ts.user_id = v_user_id
              AND ts.question_bank_id = p_bank_id
              AND ts.is_completed = FALSE
              AND ua.id IS NULL
        )
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
        INTO selected_question_ids
        FROM (
            SELECT q.id AS question_id, random() AS random_key
            FROM suspended_candidates suspended
            JOIN public.question_bank_questions qbq
              ON qbq.question_id = suspended.question_id
             AND qbq.question_bank_id = p_bank_id
            JOIN public.questions q ON q.id = suspended.question_id
            WHERE (COALESCE(cardinality(p_difficulties), 0) = 0 OR q.difficulty = ANY(p_difficulties))
              AND (
                  (COALESCE(cardinality(p_categories), 0) = 0 AND jsonb_array_length(p_topics) = 0)
                  OR q.category = ANY(p_categories)
                  OR EXISTS (
                      SELECT 1 FROM jsonb_array_elements(p_topics) AS topic_filter
                      WHERE topic_filter->>'category' = q.category
                        AND topic_filter->>'topic' = q.topic
                  )
              )
            ORDER BY random_key
            LIMIT effective_limit
        ) chosen;

    ELSE
        -- new_only: scan around a random pivot and skip finalized/actively locked questions.
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.segment, chosen.shuffle_key, chosen.question_id)
        INTO selected_question_ids
        FROM (
            SELECT *
            FROM (
                (
                    SELECT
                        q.id AS question_id,
                        qbq.shuffle_key,
                        0 AS segment
                    FROM public.question_bank_questions qbq
                    JOIN public.questions q ON q.id = qbq.question_id
                    WHERE qbq.question_bank_id = p_bank_id
                      AND qbq.shuffle_key >= selection_pivot
                      AND (COALESCE(cardinality(p_difficulties), 0) = 0 OR q.difficulty = ANY(p_difficulties))
                      AND (
                          (COALESCE(cardinality(p_categories), 0) = 0 AND jsonb_array_length(p_topics) = 0)
                          OR q.category = ANY(p_categories)
                          OR EXISTS (
                              SELECT 1 FROM jsonb_array_elements(p_topics) AS topic_filter
                              WHERE topic_filter->>'category' = q.category
                                AND topic_filter->>'topic' = q.topic
                          )
                      )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM public.user_answers ua
                          JOIN public.test_sessions answer_session ON answer_session.id = ua.test_session_id
                          WHERE ua.user_id = v_user_id
                            AND ua.question_id = q.id
                            AND (
                                answer_session.is_completed = TRUE
                                OR answer_session.session_type IN ('standard', 'tutor')
                            )
                      )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM public.test_session_questions tsq
                          JOIN public.test_sessions active_session ON active_session.id = tsq.test_session_id
                          WHERE tsq.question_id = q.id
                            AND active_session.user_id = v_user_id
                            AND active_session.question_bank_id = p_bank_id
                            AND active_session.is_completed = FALSE
                      )
                    ORDER BY qbq.shuffle_key, qbq.question_id
                    LIMIT effective_limit
                )
                UNION ALL
                (
                    SELECT
                        q.id AS question_id,
                        qbq.shuffle_key,
                        1 AS segment
                    FROM public.question_bank_questions qbq
                    JOIN public.questions q ON q.id = qbq.question_id
                    WHERE qbq.question_bank_id = p_bank_id
                      AND qbq.shuffle_key < selection_pivot
                      AND (COALESCE(cardinality(p_difficulties), 0) = 0 OR q.difficulty = ANY(p_difficulties))
                      AND (
                          (COALESCE(cardinality(p_categories), 0) = 0 AND jsonb_array_length(p_topics) = 0)
                          OR q.category = ANY(p_categories)
                          OR EXISTS (
                              SELECT 1 FROM jsonb_array_elements(p_topics) AS topic_filter
                              WHERE topic_filter->>'category' = q.category
                                AND topic_filter->>'topic' = q.topic
                          )
                      )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM public.user_answers ua
                          JOIN public.test_sessions answer_session ON answer_session.id = ua.test_session_id
                          WHERE ua.user_id = v_user_id
                            AND ua.question_id = q.id
                            AND (
                                answer_session.is_completed = TRUE
                                OR answer_session.session_type IN ('standard', 'tutor')
                            )
                      )
                      AND NOT EXISTS (
                          SELECT 1
                          FROM public.test_session_questions tsq
                          JOIN public.test_sessions active_session ON active_session.id = tsq.test_session_id
                          WHERE tsq.question_id = q.id
                            AND active_session.user_id = v_user_id
                            AND active_session.question_bank_id = p_bank_id
                            AND active_session.is_completed = FALSE
                      )
                    ORDER BY qbq.shuffle_key, qbq.question_id
                    LIMIT effective_limit
                )
            ) ring_candidates
            ORDER BY segment, shuffle_key, question_id
            LIMIT effective_limit
        ) chosen;
    END IF;

    selected_count := COALESCE(cardinality(selected_question_ids), 0);
    IF selected_count = 0 THEN
        RAISE EXCEPTION 'No questions match the selected filters';
    END IF;

    -- INSERT ... RETURNING gives us the authoritative row after BEFORE triggers.
    -- All existing trial/access triggers still execute exactly as before.
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
        v_user_id,
        p_bank_id,
        p_session_type,
        COALESCE(p_categories, ARRAY[]::TEXT[]),
        COALESCE(p_difficulties, ARRAY[]::TEXT[]),
        p_question_selection,
        p_topics,
        selected_count,
        FALSE
    )
    RETURNING * INTO new_session;

    INSERT INTO public.test_session_questions(
        test_session_id,
        question_id,
        sort_order
    )
    SELECT
        new_session.id,
        selected.question_id,
        selected.ordinality::INTEGER - 1
    FROM unnest(selected_question_ids) WITH ORDINALITY AS selected(question_id, ordinality);

    -- Preserve the first fresh post-insert authorization boundary from
    -- get_exam_session_bootstrap(). Do not replace this with the earlier
    -- has_premium/is_active result: READ COMMITTED allows a later statement to
    -- observe an account suspension or entitlement revocation.
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT public.can_access_question_bank(new_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    -- Preserve the exact flag semantics of get_exam_session_bootstrap without
    -- re-reading test_session_questions: selected_question_ids is the canonical
    -- order that was just inserted above.
    SELECT COALESCE(
        jsonb_agg(selected.question_id ORDER BY selected.ordinality),
        '[]'::jsonb
    )
    INTO flagged_payload
    FROM unnest(selected_question_ids) WITH ORDINALITY AS selected(question_id, ordinality)
    JOIN public.user_question_flags uqf
      ON uqf.user_id = v_user_id
     AND uqf.question_id = selected.question_id;

    -- Preserve the second fresh authorization boundary that used to occur in
    -- get_exam_session_window() immediately before the question payload query.
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT public.can_access_question_bank(new_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    -- Build only Q1 from the selected id already in memory. The payload is
    -- intentionally answer-safe and matches get_exam_session_window().
    SELECT COALESCE((
        SELECT jsonb_build_array(
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
        )
        FROM public.questions q
        WHERE q.id = selected_question_ids[1]
    ), '[]'::jsonb)
    INTO first_question_payload;

    RETURN jsonb_build_object(
        'status', 'active',
        'session', jsonb_build_object(
            'id', new_session.id,
            'question_bank_id', new_session.question_bank_id,
            'session_type', new_session.session_type,
            'time_limit_minutes', new_session.time_limit_minutes,
            'total_questions', COALESCE(new_session.total_questions, 0),
            'is_completed', FALSE
        ),
        'question_ids', COALESCE(to_jsonb(selected_question_ids), '[]'::jsonb),
        'questions', first_question_payload,
        'answers', '[]'::jsonb,
        'flagged_question_ids', flagged_payload,
        'current_index', 0
    );
END;
$$;
