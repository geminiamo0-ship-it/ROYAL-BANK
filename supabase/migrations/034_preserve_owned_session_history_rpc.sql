-- Session-list history is owned history, not a current-content entitlement.
-- Keep question/explanation review gated by current bank access, but allow active users
-- to list their own historical sessions after an entitlement expires.

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
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
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

REVOKE ALL ON FUNCTION public.get_my_bank_sessions(bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_bank_sessions(bigint, integer) TO authenticated;
