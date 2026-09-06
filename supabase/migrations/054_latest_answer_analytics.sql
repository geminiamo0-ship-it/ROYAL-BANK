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
        WHERE ua.user_id = p_user_id
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
