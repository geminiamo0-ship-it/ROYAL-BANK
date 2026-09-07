-- Category/topic counts are safe aggregate metadata, but the definer function must
-- still validate that the caller may access the requested bank and must not have a
-- special hard-coded Bank 1 data path.

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
        SELECT q.category, q.topic, COUNT(*) AS total_questions
        FROM public.question_bank_questions qbq
        JOIN public.questions q ON q.id = qbq.question_id
        WHERE qbq.question_bank_id = p_bank_id
          AND q.category IS NOT NULL
        GROUP BY q.category, q.topic
    ) t;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(INT) TO authenticated;
