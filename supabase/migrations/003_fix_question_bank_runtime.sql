-- Keep the cached question-bank outline compatible with server-side service-role reads
-- while preserving canonical bank authorization for normal authenticated callers.
-- Aggregate directly from the bank/question mapping so difficulty totals cannot drift
-- from the source rows used by the exam selector.

CREATE OR REPLACE FUNCTION public.get_category_topic_counts_json(p_bank_id INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    result JSON;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required';
        END IF;

        IF NOT public.can_access_question_bank(p_bank_id::BIGINT) THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    END IF;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    INTO result
    FROM (
        SELECT
            q.category,
            q.topic,
            COALESCE(q.difficulty, '1') AS difficulty,
            COUNT(*)::INT AS total_questions
        FROM public.question_bank_questions qbq
        JOIN public.questions q
          ON q.id = qbq.question_id
        WHERE qbq.question_bank_id = p_bank_id
        GROUP BY
            q.category,
            q.topic,
            COALESCE(q.difficulty, '1')
        ORDER BY
            q.category,
            q.topic NULLS FIRST,
            COALESCE(q.difficulty, '1')
    ) t;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(INT) TO service_role;
