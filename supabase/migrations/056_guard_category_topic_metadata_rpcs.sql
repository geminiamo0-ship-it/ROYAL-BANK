-- Harden legacy category/topic aggregate RPC overloads that bypass RLS under
-- SECURITY DEFINER. These RPCs expose only metadata, but private-bank metadata
-- must follow the same canonical bank entitlement checks as other bank APIs.

CREATE OR REPLACE FUNCTION public.get_category_topic_counts(p_bank_id integer)
RETURNS TABLE(category text, topic text, total_questions bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required';
        END IF;

        IF NOT public.can_access_question_bank(p_bank_id::bigint) THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    END IF;

    IF p_bank_id = 1 THEN
        RETURN QUERY
        SELECT q.category, q.topic, COUNT(*)::bigint
        FROM public.questions q
        WHERE q.category IS NOT NULL
        GROUP BY q.category, q.topic;
    ELSE
        RETURN QUERY
        SELECT q.category, q.topic, COUNT(*)::bigint
        FROM public.question_bank_questions qbq
        JOIN public.questions q ON q.id = qbq.question_id
        WHERE qbq.question_bank_id = p_bank_id
          AND q.category IS NOT NULL
        GROUP BY q.category, q.topic;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_category_topic_counts_json(p_bank_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_result json;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required';
        END IF;

        IF NOT public.can_access_question_bank(p_bank_id) THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    END IF;

    -- Keep this overload aligned with the canonical materialized view shape:
    -- question_bank_id, category, topic, total_questions. The legacy production
    -- function referenced a non-existent difficulty column and therefore failed
    -- for otherwise-authorized callers.
    SELECT json_agg(row_to_json(t))
    INTO v_result
    FROM (
        SELECT category, topic, total_questions
        FROM public.question_bank_topic_counts
        WHERE question_bank_id = p_bank_id
    ) t;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_category_topic_counts(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_category_topic_counts_json(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_category_topic_counts_json(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_category_topic_counts(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(integer) TO authenticated, service_role;
