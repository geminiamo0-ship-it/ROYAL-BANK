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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id::BIGINT) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    INTO result
    FROM (
        SELECT category, topic, total_questions
        FROM public.question_bank_topic_counts
        WHERE question_bank_id = p_bank_id
        ORDER BY category, topic NULLS FIRST
    ) t;

    RETURN result;
END;
$$;
