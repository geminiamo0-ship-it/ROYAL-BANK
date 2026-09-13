-- Keep Study Plan's secondary QBank metrics semantically identical to the
-- main Performance dashboard: one authoritative state per bank question.

CREATE OR REPLACE FUNCTION public.get_study_plan_dashboard(p_bank_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_plan public.study_plans%ROWTYPE;
    v_tasks JSONB := '[]'::jsonb;
    v_categories JSONB := '[]'::jsonb;
    v_periods JSONB := '[]'::jsonb;
    v_total INTEGER := 0;
    v_completed INTEGER := 0;
    v_due INTEGER := 0;
    v_overdue INTEGER := 0;
    v_completed_future INTEGER := 0;
    v_practiced INTEGER := 0;
    v_correct INTEGER := 0;
    v_status TEXT := 'on_track';
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT * INTO v_plan
    FROM public.study_plans
    WHERE user_id = auth.uid()
      AND question_bank_id = p_bank_id
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'bank_id', p_bank_id,
            'plan', NULL,
            'catalog', public.get_study_plan_catalog(p_bank_id)
        );
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE status = 'completed')::INTEGER,
        COUNT(*) FILTER (WHERE scheduled_date <= CURRENT_DATE)::INTEGER,
        COUNT(*) FILTER (WHERE status = 'pending' AND scheduled_date < CURRENT_DATE)::INTEGER,
        COUNT(*) FILTER (WHERE status = 'completed' AND scheduled_date > CURRENT_DATE)::INTEGER
    INTO v_total, v_completed, v_due, v_overdue, v_completed_future
    FROM public.study_plan_tasks
    WHERE plan_id = v_plan.id;

    IF v_overdue > 0 THEN
        v_status := 'behind';
    ELSIF v_completed_future > 0 OR v_completed > v_due THEN
        v_status := 'ahead';
    ELSE
        v_status := 'on_track';
    END IF;

    SELECT COALESCE(jsonb_agg(task_payload ORDER BY scheduled_date, category_name, topic_name), '[]'::jsonb)
    INTO v_tasks
    FROM (
        SELECT
            spt.scheduled_date,
            COALESCE(ct.category, 'General') AS category_name,
            ct.name AS topic_name,
            jsonb_build_object(
                'id', spt.id,
                'topic_id', ct.id,
                'topic', ct.name,
                'category', COALESCE(ct.category, 'General'),
                'scheduled_date', spt.scheduled_date,
                'status', spt.status,
                'completed_at', spt.completed_at,
                'question_count', (
                    SELECT COUNT(*)::INTEGER
                    FROM public.question_topics qt
                    WHERE qt.question_bank_id = p_bank_id AND qt.topic_id = ct.id
                ),
                'article_id', (
                    SELECT tla.article_id
                    FROM public.topic_library_articles tla
                    WHERE tla.question_bank_id = p_bank_id AND tla.topic_id = ct.id
                    ORDER BY tla.is_primary DESC, tla.display_order, tla.article_id
                    LIMIT 1
                ),
                'exam_filters', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object('category', f.category, 'topic', f.topic)
                        ORDER BY f.category, f.topic)
                    FROM (
                        SELECT DISTINCT q.category, q.topic
                        FROM public.question_topics qt
                        JOIN public.questions q ON q.id = qt.question_id
                        WHERE qt.question_bank_id = p_bank_id
                          AND qt.topic_id = ct.id
                          AND q.topic IS NOT NULL
                    ) f
                ), '[]'::jsonb),
                'session_id', (
                    SELECT spsl.session_id
                    FROM public.study_plan_session_links spsl
                    WHERE spsl.task_id = spt.id
                    ORDER BY spsl.created_at DESC
                    LIMIT 1
                )
            ) AS task_payload
        FROM public.study_plan_tasks spt
        JOIN public.content_topics ct ON ct.id = spt.topic_id
        WHERE spt.plan_id = v_plan.id
    ) task_rows;

    SELECT COALESCE(jsonb_agg(category_payload ORDER BY priority, category_name), '[]'::jsonb)
    INTO v_categories
    FROM (
        SELECT
            COALESCE(ct.category, 'General') AS category_name,
            COALESCE(spcp.priority, 100000) AS priority,
            jsonb_build_object(
                'category', COALESCE(ct.category, 'General'),
                'priority', COALESCE(spcp.priority, 100000),
                'total', COUNT(*),
                'completed', COUNT(*) FILTER (WHERE spt.status = 'completed'),
                'progress', CASE WHEN COUNT(*) = 0 THEN 0
                    ELSE ROUND((COUNT(*) FILTER (WHERE spt.status = 'completed')::NUMERIC / COUNT(*)::NUMERIC) * 100)
                END
            ) AS category_payload
        FROM public.study_plan_tasks spt
        JOIN public.content_topics ct ON ct.id = spt.topic_id
        LEFT JOIN public.study_plan_category_priorities spcp
          ON spcp.plan_id = v_plan.id
         AND spcp.category_name = COALESCE(ct.category, 'General')
        WHERE spt.plan_id = v_plan.id
        GROUP BY COALESCE(ct.category, 'General'), COALESCE(spcp.priority, 100000)
    ) category_rows;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'start_date', start_date, 'end_date', end_date, 'mode', mode
    ) ORDER BY start_date, id), '[]'::jsonb)
    INTO v_periods
    FROM public.study_plan_periods
    WHERE plan_id = v_plan.id;

    SELECT
        COUNT(*) FILTER (WHERE states.answer_state IS NOT NULL)::INTEGER,
        COUNT(*) FILTER (WHERE states.answer_state = 'correct')::INTEGER
    INTO v_practiced, v_correct
    FROM public.get_user_question_states(p_bank_id) states;

    RETURN jsonb_build_object(
        'bank_id', p_bank_id,
        'plan', jsonb_build_object(
            'id', v_plan.id,
            'start_date', v_plan.start_date,
            'exam_date', v_plan.exam_date,
            'study_weekdays', v_plan.study_weekdays,
            'missed_strategy', v_plan.missed_strategy,
            'reduced_load_factor', v_plan.reduced_load_factor,
            'status', v_status,
            'total_topics', v_total,
            'completed_topics', v_completed,
            'progress', CASE WHEN v_total = 0 THEN 0 ELSE ROUND((v_completed::NUMERIC / v_total::NUMERIC) * 100) END,
            'questions_practiced', v_practiced,
            'qbank_accuracy', CASE WHEN v_practiced = 0 THEN 0 ELSE ROUND((v_correct::NUMERIC / v_practiced::NUMERIC) * 100) END,
            'periods', v_periods,
            'categories', v_categories,
            'tasks', v_tasks
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_plan_dashboard(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_plan_dashboard(BIGINT) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_study_plan_dashboard(BIGINT) IS
    'Single read boundary for active Study Plan. QBank practice metrics use get_user_question_states so each question contributes one authoritative current answer state.';
