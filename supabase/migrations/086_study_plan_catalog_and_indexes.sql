-- Follow-up hardening for Study Plan catalog aggregation and FK coverage.

CREATE INDEX IF NOT EXISTS idx_question_topics_question
    ON public.question_topics(question_id);
CREATE INDEX IF NOT EXISTS idx_topic_library_articles_topic
    ON public.topic_library_articles(topic_id);
CREATE INDEX IF NOT EXISTS idx_topic_library_articles_article
    ON public.topic_library_articles(article_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_bank
    ON public.study_plans(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_study_plan_tasks_topic
    ON public.study_plan_tasks(topic_id);

CREATE OR REPLACE FUNCTION public.get_study_plan_catalog(p_bank_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    WITH topic_rows AS (
        SELECT
            ct.id,
            ct.name,
            COALESCE(ct.category, 'General') AS category_name,
            ct.display_order,
            (
                SELECT COUNT(*)::INTEGER
                FROM public.question_topics qt
                WHERE qt.question_bank_id = p_bank_id
                  AND qt.topic_id = ct.id
            ) AS question_count,
            (
                SELECT tla.article_id
                FROM public.topic_library_articles tla
                WHERE tla.question_bank_id = p_bank_id
                  AND tla.topic_id = ct.id
                ORDER BY tla.is_primary DESC, tla.display_order, tla.article_id
                LIMIT 1
            ) AS article_id
        FROM public.content_topics ct
        WHERE ct.question_bank_id = p_bank_id
          AND EXISTS (
              SELECT 1
              FROM public.question_topics qt
              WHERE qt.question_bank_id = p_bank_id
                AND qt.topic_id = ct.id
          )
    ), category_rows AS (
        SELECT
            tr.category_name,
            jsonb_build_object(
                'name', tr.category_name,
                'topic_count', COUNT(*),
                'topics', jsonb_agg(
                    jsonb_build_object(
                        'id', tr.id,
                        'name', tr.name,
                        'question_count', tr.question_count,
                        'article_id', tr.article_id
                    ) ORDER BY tr.display_order, tr.name, tr.id
                )
            ) AS category_payload
        FROM topic_rows tr
        GROUP BY tr.category_name
    )
    SELECT jsonb_build_object(
        'bank_id', p_bank_id,
        'topic_count', (SELECT COUNT(*) FROM topic_rows),
        'categories', COALESCE(
            (SELECT jsonb_agg(cr.category_payload ORDER BY cr.category_name) FROM category_rows cr),
            '[]'::jsonb
        )
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_plan_catalog(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_plan_catalog(BIGINT) TO authenticated, service_role;
