SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

-- Live bank performance and session history.
-- All metrics are derived from persisted user answers, question difficulty,
-- and empirical correct-option percentages. Missing benchmark percentages are
-- excluded from peer/percentile math rather than replaced with invented values.

CREATE OR REPLACE FUNCTION public.get_question_bank_performance(p_bank_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    WITH bank_meta AS (
        SELECT qb.name, qb.description
        FROM public.question_banks qb
        WHERE qb.id = p_bank_id
    ),
    question_reference AS (
        SELECT
            q.id AS question_id,
            COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized') AS category,
            COALESCE(q.topic, '') AS topic,
            COALESCE(NULLIF(BTRIM(q.difficulty), ''), '2') AS difficulty,
            CASE
                WHEN COALESCE(NULLIF(BTRIM(q.difficulty), ''), '2') IN ('1', 'easy', 'Easy', 'EASY') THEN 0.90::numeric
                WHEN COALESCE(NULLIF(BTRIM(q.difficulty), ''), '2') IN ('3', 'hard', 'Hard', 'HARD') THEN 1.10::numeric
                ELSE 1.00::numeric
            END AS difficulty_weight,
            CASE
                WHEN COUNT(*) FILTER (WHERE o.is_correct = TRUE AND o.percentage IS NOT NULL) = 0 THEN NULL
                ELSE LEAST(
                    0.99::numeric,
                    GREATEST(
                        0.01::numeric,
                        MAX(o.percentage) FILTER (WHERE o.is_correct = TRUE AND o.percentage IS NOT NULL)::numeric / 100.0
                    )
                )
            END AS peer_probability
        FROM public.question_bank_questions qbq
        JOIN public.questions q ON q.id = qbq.question_id
        LEFT JOIN public.options o ON o.question_id = q.id
        WHERE qbq.question_bank_id = p_bank_id
        GROUP BY q.id, q.category, q.topic, q.difficulty
    ),
    states AS (
        SELECT *
        FROM public.get_user_question_states(p_bank_id)
    ),
    answered AS (
        SELECT
            qr.question_id,
            qr.category,
            qr.topic,
            qr.difficulty,
            qr.difficulty_weight,
            qr.peer_probability,
            (states.answer_state = 'correct') AS is_correct
        FROM states
        JOIN question_reference qr ON qr.question_id = states.question_id
        WHERE states.answer_state IS NOT NULL
    ),
    overall AS (
        SELECT
            COUNT(*)::int AS answered_count,
            COUNT(*) FILTER (WHERE is_correct)::int AS correct_count,
            COUNT(*) FILTER (WHERE NOT is_correct)::int AS incorrect_count,
            COUNT(*) FILTER (WHERE peer_probability IS NOT NULL)::int AS benchmark_count,
            COALESCE(SUM(difficulty_weight) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS benchmark_weight_sum,
            COALESCE(SUM(difficulty_weight * CASE WHEN is_correct THEN 1 ELSE 0 END) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS weighted_correct,
            COALESCE(SUM(difficulty_weight * peer_probability) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS weighted_expected,
            COALESCE(SUM(difficulty_weight * difficulty_weight * peer_probability * (1 - peer_probability)) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS weighted_variance
        FROM answered
    ),
    overall_scores AS (
        SELECT
            overall.*,
            CASE WHEN answered_count > 0 THEN ROUND((correct_count::numeric / answered_count) * 100, 1) ELSE NULL END AS raw_accuracy,
            CASE WHEN benchmark_weight_sum > 0 THEN ROUND((weighted_correct / benchmark_weight_sum) * 100, 1) ELSE NULL END AS user_score,
            CASE WHEN benchmark_weight_sum > 0 THEN ROUND((weighted_expected / benchmark_weight_sum) * 100, 1) ELSE NULL END AS peer_average,
            CASE
                WHEN benchmark_count = 0 OR weighted_variance <= 0 THEN NULL
                ELSE
                    (weighted_correct - weighted_expected)
                    / SQRT(weighted_variance)
                    * SQRT(benchmark_count::numeric / (benchmark_count + 10)::numeric)
            END AS adjusted_z
        FROM overall
    ),
    category_rollup AS (
        SELECT
            category,
            COUNT(*)::int AS answered_count,
            COUNT(*) FILTER (WHERE is_correct)::int AS correct_count,
            COUNT(*) FILTER (WHERE NOT is_correct)::int AS incorrect_count,
            COUNT(*) FILTER (WHERE peer_probability IS NOT NULL)::int AS benchmark_count,
            COALESCE(SUM(difficulty_weight) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS benchmark_weight_sum,
            COALESCE(SUM(difficulty_weight * CASE WHEN is_correct THEN 1 ELSE 0 END) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS weighted_correct,
            COALESCE(SUM(difficulty_weight * peer_probability) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS weighted_expected,
            COALESCE(SUM(difficulty_weight * difficulty_weight * peer_probability * (1 - peer_probability)) FILTER (WHERE peer_probability IS NOT NULL), 0)::numeric AS weighted_variance
        FROM answered
        GROUP BY category
    ),
    category_scores AS (
        SELECT
            category,
            answered_count,
            correct_count,
            incorrect_count,
            benchmark_count,
            ROUND((correct_count::numeric / NULLIF(answered_count, 0)) * 100, 1) AS raw_accuracy,
            CASE WHEN benchmark_weight_sum > 0 THEN ROUND((weighted_correct / benchmark_weight_sum) * 100, 1) ELSE NULL END AS user_score,
            CASE WHEN benchmark_weight_sum > 0 THEN ROUND((weighted_expected / benchmark_weight_sum) * 100, 1) ELSE NULL END AS peer_average,
            CASE
                WHEN benchmark_count = 0 OR weighted_variance <= 0 THEN NULL
                ELSE
                    (weighted_correct - weighted_expected)
                    / SQRT(weighted_variance)
                    * SQRT(benchmark_count::numeric / (benchmark_count + 8)::numeric)
            END AS adjusted_z
        FROM category_rollup
    ),
    category_payload AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'category', category,
                    'answered', answered_count,
                    'correct', correct_count,
                    'incorrect', incorrect_count,
                    'benchmark_questions', benchmark_count,
                    'accuracy', raw_accuracy,
                    'user_score', user_score,
                    'peer_average', peer_average,
                    'estimated_percentile', CASE
                        WHEN adjusted_z IS NULL THEN NULL
                        ELSE ROUND(
                            LEAST(
                                99::numeric,
                                GREATEST(
                                    1::numeric,
                                    100::numeric / (1 + EXP(-1.702 * LEAST(6::numeric, GREATEST(-6::numeric, adjusted_z))))
                                )
                            ),
                            0
                        )
                    END
                )
                ORDER BY answered_count DESC, category ASC
            ),
            '[]'::jsonb
        ) AS payload
        FROM category_scores
    ),
    difficulty_payload AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'difficulty', difficulty,
                    'answered', answered_count,
                    'correct', correct_count,
                    'accuracy', CASE WHEN answered_count > 0 THEN ROUND(correct_count::numeric / answered_count * 100, 1) ELSE NULL END,
                    'peer_average', CASE WHEN benchmark_count > 0 THEN ROUND(peer_average, 1) ELSE NULL END
                )
                ORDER BY difficulty
            ),
            '[]'::jsonb
        ) AS payload
        FROM (
            SELECT
                difficulty,
                COUNT(*)::int AS answered_count,
                COUNT(*) FILTER (WHERE is_correct)::int AS correct_count,
                COUNT(*) FILTER (WHERE peer_probability IS NOT NULL)::int AS benchmark_count,
                AVG(peer_probability * 100) FILTER (WHERE peer_probability IS NOT NULL)::numeric AS peer_average
            FROM answered
            GROUP BY difficulty
        ) difficulty_rows
    ),
    activity_rows AS (
        SELECT
            ua.answered_at::date AS activity_date,
            COUNT(*)::int AS answered_count,
            COUNT(*) FILTER (WHERE ua.is_correct)::int AS correct_count
        FROM public.user_answers ua
        WHERE ua.user_id = auth.uid()
          AND ua.answered_at >= (CURRENT_DATE - 97)
          AND EXISTS (
              SELECT 1
              FROM public.question_bank_questions qbq
              WHERE qbq.question_bank_id = p_bank_id
                AND qbq.question_id = ua.question_id
          )
        GROUP BY ua.answered_at::date
    ),
    activity_payload AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'date', activity_date,
                    'answered', answered_count,
                    'correct', correct_count,
                    'accuracy', CASE WHEN answered_count > 0 THEN ROUND(correct_count::numeric / answered_count * 100, 1) ELSE NULL END
                )
                ORDER BY activity_date
            ),
            '[]'::jsonb
        ) AS payload
        FROM activity_rows
    ),
    active_days AS (
        SELECT DISTINCT ua.answered_at::date AS activity_date
        FROM public.user_answers ua
        WHERE ua.user_id = auth.uid()
          AND EXISTS (
              SELECT 1
              FROM public.question_bank_questions qbq
              WHERE qbq.question_bank_id = p_bank_id
                AND qbq.question_id = ua.question_id
          )
    ),
    active_day_groups AS (
        SELECT
            activity_date,
            activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date))::int AS group_key
        FROM active_days
    ),
    streak AS (
        SELECT
            CASE
                WHEN MAX(activity_date) IS NULL OR MAX(activity_date) < CURRENT_DATE - 1 THEN 0
                ELSE COALESCE((
                    SELECT COUNT(*)::int
                    FROM active_day_groups g
                    WHERE g.group_key = (
                        SELECT anchor.group_key
                        FROM active_day_groups anchor
                        WHERE anchor.activity_date = (SELECT MAX(activity_date) FROM active_days)
                        LIMIT 1
                    )
                ), 0)
            END AS streak_days
        FROM active_days
    ),
    state_totals AS (
        SELECT
            COUNT(*)::int AS total_questions,
            COUNT(*) FILTER (WHERE is_flagged)::int AS flagged_questions,
            COUNT(*) FILTER (WHERE is_suspended)::int AS suspended_questions
        FROM states
    ),
    today AS (
        SELECT COALESCE(SUM(answered_count), 0)::int AS answered_today
        FROM activity_rows
        WHERE activity_date = CURRENT_DATE
    )
    SELECT jsonb_build_object(
        'bank_name', bank_meta.name,
        'bank_description', bank_meta.description,
        'total_questions', state_totals.total_questions,
        'answered', overall_scores.answered_count,
        'correct', overall_scores.correct_count,
        'incorrect', overall_scores.incorrect_count,
        'benchmark_questions', overall_scores.benchmark_count,
        'flagged', state_totals.flagged_questions,
        'suspended', state_totals.suspended_questions,
        'completion_percentage', CASE
            WHEN state_totals.total_questions > 0 THEN ROUND(overall_scores.answered_count::numeric / state_totals.total_questions * 100, 1)
            ELSE 0
        END,
        'accuracy', overall_scores.raw_accuracy,
        'difficulty_adjusted_score', overall_scores.user_score,
        'peer_average', overall_scores.peer_average,
        'estimated_percentile', CASE
            WHEN overall_scores.adjusted_z IS NULL THEN NULL
            ELSE ROUND(
                LEAST(
                    99::numeric,
                    GREATEST(
                        1::numeric,
                        100::numeric / (1 + EXP(-1.702 * LEAST(6::numeric, GREATEST(-6::numeric, overall_scores.adjusted_z))))
                    )
                ),
                0
            )
        END,
        'answered_today', today.answered_today,
        'streak_days', streak.streak_days,
        'categories', category_payload.payload,
        'difficulty', difficulty_payload.payload,
        'activity', activity_payload.payload,
        'method', 'Empirical correct-option percentages are the peer benchmark; question difficulty weights are 0.9/1.0/1.1; percentile is a small-sample-shrunk performance estimate mapped through a logistic normal-CDF approximation. Questions without an empirical correct percentage are excluded from benchmark math.'
    )
    INTO v_result
    FROM bank_meta
    CROSS JOIN overall_scores
    CROSS JOIN state_totals
    CROSS JOIN category_payload
    CROSS JOIN difficulty_payload
    CROSS JOIN activity_payload
    CROSS JOIN streak
    CROSS JOIN today;

    RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_bank_sessions(
    p_bank_id bigint,
    p_limit integer DEFAULT 100
)
RETURNS TABLE(
    id uuid,
    started_at timestamptz,
    completed_at timestamptz,
    categories text[],
    total_questions integer,
    session_type text,
    is_completed boolean,
    score_percentage real,
    answered_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    RETURN QUERY
    SELECT
        ts.id,
        ts.started_at,
        ts.completed_at,
        ts.categories,
        ts.total_questions,
        ts.session_type,
        ts.is_completed,
        ts.score_percentage,
        COUNT(ua.id)::bigint AS answered_count
    FROM public.test_sessions ts
    LEFT JOIN public.user_answers ua
      ON ua.test_session_id = ts.id
     AND ua.user_id = auth.uid()
    WHERE ts.user_id = auth.uid()
      AND ts.question_bank_id = p_bank_id
    GROUP BY
        ts.id,
        ts.started_at,
        ts.completed_at,
        ts.categories,
        ts.total_questions,
        ts.session_type,
        ts.is_completed,
        ts.score_percentage
    ORDER BY ts.started_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_bank_performance(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_my_bank_sessions(bigint, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_question_bank_performance(bigint) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_bank_sessions(bigint, integer) TO authenticated;
