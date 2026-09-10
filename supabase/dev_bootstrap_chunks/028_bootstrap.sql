-- Read-only review surface for completed exam sessions.
-- It is intentionally separate from the active-session window RPCs so review can never
-- mutate or weaken the sequencing/rate-limit rules used while a block is in progress.

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_window(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_session public.test_sessions;
    v_payload jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;
    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;
    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF NOT public.can_read_locked_session(p_session_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
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
            ORDER BY tsq.sort_order
        ),
        '[]'::jsonb
    ) INTO v_payload
    FROM public.test_session_questions tsq
    JOIN public.questions q ON q.id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + p_count;

    RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_session public.test_sessions;
    v_question_ids jsonb;
    v_answers jsonb;
    v_flags jsonb;
    v_first_question jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF NOT public.can_read_locked_session(p_session_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(jsonb_agg(tsq.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_question_ids
    FROM public.test_session_questions tsq
    WHERE tsq.test_session_id = p_session_id;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'question_id', ua.question_id,
                'selected_option_id', ua.selected_option_id,
                'is_correct', ua.is_correct,
                'correct_option_id', correct_option.id,
                'time_spent_seconds', ua.time_spent_seconds
            )
            ORDER BY tsq.sort_order
        ),
        '[]'::jsonb
    ) INTO v_answers
    FROM public.test_session_questions tsq
    JOIN public.user_answers ua
      ON ua.test_session_id = p_session_id
     AND ua.user_id = auth.uid()
     AND ua.question_id = tsq.question_id
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) correct_option ON TRUE
    WHERE tsq.test_session_id = p_session_id;

    SELECT COALESCE(jsonb_agg(uqf.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_flags
    FROM public.test_session_questions tsq
    JOIN public.user_question_flags uqf
      ON uqf.question_id = tsq.question_id
     AND uqf.user_id = auth.uid()
    WHERE tsq.test_session_id = p_session_id;

    v_first_question := public.get_completed_exam_review_window(p_session_id, 0, 1);

    RETURN jsonb_build_object(
        'status', 'completed',
        'session', jsonb_build_object(
            'id', v_session.id,
            'question_bank_id', v_session.question_bank_id,
            'session_type', v_session.session_type,
            'time_limit_minutes', v_session.time_limit_minutes,
            'total_questions', COALESCE(v_session.total_questions, 0),
            'is_completed', TRUE
        ),
        'question_ids', v_question_ids,
        'questions', v_first_question,
        'answers', v_answers,
        'flagged_question_ids', v_flags,
        'current_index', 0
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_feedback(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_session public.test_sessions;
    v_answer public.user_answers;
    v_correct_option_id bigint;
    v_explanation text;
    v_percentages jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF NOT v_session.is_completed THEN
        RAISE EXCEPTION 'Session is not completed';
    END IF;
    IF NOT public.can_read_locked_session(p_session_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = p_session_id
          AND tsq.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'Question does not belong to session';
    END IF;

    SELECT * INTO v_answer
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
      AND ua.question_id = p_question_id
    ORDER BY ua.answered_at DESC, ua.id DESC
    LIMIT 1;

    SELECT o.id INTO v_correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT q.explanation_html INTO v_explanation
    FROM public.questions q
    WHERE q.id = p_question_id;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    ) INTO v_percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', v_answer.selected_option_id,
        'is_correct', COALESCE(v_answer.is_correct, FALSE),
        'correct_option_id', v_correct_option_id,
        'explanation_html', v_explanation,
        'option_percentages', v_percentages
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_completed_exam_review_window(uuid, integer, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window(uuid, integer, integer) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(uuid, bigint) TO authenticated;

-- Keep completed-session question/explanation reads behind the same mandatory BFF gateway
-- as the active exam engine. Analytics/session-list RPCs do not disclose question content.

CREATE OR REPLACE FUNCTION api_hooks.royal_exam_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_cfg private.exam_gateway_config%ROWTYPE;
    v_path TEXT := NULLIF(current_setting('request.path', TRUE), '');
    v_method TEXT := UPPER(COALESCE(NULLIF(current_setting('request.method', TRUE), ''), ''));
    v_headers JSONB := COALESCE(
        NULLIF(current_setting('request.headers', TRUE), ''),
        '{}'
    )::jsonb;
    v_rpc_name TEXT;
    v_key_id TEXT;
    v_key TEXT;
BEGIN
    PERFORM set_config('request.royal_gateway_verified', '0', TRUE);

    SELECT * INTO v_cfg
    FROM private.exam_gateway_config
    WHERE singleton = TRUE;

    IF NOT FOUND OR NOT v_cfg.enforcement_enabled THEN
        RETURN;
    END IF;

    v_rpc_name := substring(COALESCE(v_path, '') FROM '/rpc/([^/?]+)$');

    IF v_method <> 'POST'
       OR v_rpc_name IS NULL
       OR v_rpc_name <> ALL (ARRAY[
            'create_exam_session_bootstrap',
            'create_exam_session_bootstrap_idempotent',
            'get_exam_session_bootstrap',
            'get_exam_session_window',
            'get_completed_exam_review_bootstrap',
            'get_completed_exam_review_window',
            'get_completed_exam_review_feedback',
            'submit_exam_answer_with_feedback',
            'submit_exam_answer',
            'get_exam_question_feedback',
            'set_question_flag',
            'complete_exam_session',
            'record_exam_gateway_rate_limit_rejection'
       ]::TEXT[]) THEN
        RETURN;
    END IF;

    v_key_id := NULLIF(v_headers->>'x-royal-gateway-key-id', '');
    v_key := NULLIF(v_headers->>'x-royal-gateway-key', '');

    IF v_key_id IS NULL
       OR v_key IS NULL
       OR NOT private.is_valid_exam_gateway_key(v_key_id, v_key, clock_timestamp()) THEN
        RAISE SQLSTATE 'PT403'
            USING MESSAGE = 'Exam gateway required';
    END IF;

    PERFORM set_config('request.royal_gateway_verified', '1', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request() FROM PUBLIC;

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

-- Supabase project default privileges grant EXECUTE to anon/authenticated/service_role
-- on newly created functions. These user-specific analytics/review RPCs are intended
-- for authenticated users only, so revoke anon explicitly as well as PUBLIC.

REVOKE EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_my_bank_sessions(BIGINT, INTEGER) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_my_bank_sessions(BIGINT, INTEGER) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(UUID) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(UUID) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_window(UUID, INTEGER, INTEGER) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_window(UUID, INTEGER, INTEGER) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(UUID, BIGINT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(UUID, BIGINT) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_bank_sessions(BIGINT, INTEGER) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window(UUID, INTEGER, INTEGER) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback(UUID, BIGINT) TO authenticated;

-- Release C: production operations surfaces for user administration, access control,
-- operational overview, support performance, and explicit admin RBAC.

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status_created_at
    ON public.upgrade_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_contacted_by_at
    ON public.upgrade_requests (contacted_by, contacted_at DESC)
    WHERE contacted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_activated_by_at
    ON public.upgrade_requests (activated_by, activated_at DESC)
    WHERE activated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_recorded_by_paid_at
    ON public.payments (recorded_by, paid_at DESC)
    WHERE recorded_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_list_users(
    p_search TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id UUID,
    full_name TEXT,
    email TEXT,
    role TEXT,
    subscription_tier TEXT,
    is_active BOOLEAN,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    created_at TIMESTAMPTZ,
    active_grant_count BIGINT,
    latest_access_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_search TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_role TEXT := NULLIF(lower(btrim(COALESCE(p_role, ''))), '');
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_search IS NOT NULL AND char_length(v_search) > 200 THEN
        RAISE EXCEPTION 'INVALID_USER_SEARCH';
    END IF;

    IF v_role IS NOT NULL AND v_role NOT IN ('student', 'support', 'admin') THEN
        RAISE EXCEPTION 'INVALID_USER_ROLE';
    END IF;

    RETURN QUERY
    SELECT
        profile.id,
        profile.full_name,
        profile.email,
        profile.role,
        profile.subscription_tier,
        profile.is_active,
        profile.last_login_at,
        profile.last_login_ip,
        profile.created_at,
        COALESCE(grants.active_grant_count, 0)::BIGINT,
        grants.latest_access_expires_at
    FROM public.profiles profile
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*)::BIGINT AS active_grant_count,
            MAX(grant_row.expires_at) FILTER (WHERE grant_row.expires_at IS NOT NULL) AS latest_access_expires_at
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = profile.id
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= now()
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ) grants ON TRUE
    WHERE (v_role IS NULL OR profile.role = v_role)
      AND (p_is_active IS NULL OR profile.is_active = p_is_active)
      AND (
          v_search IS NULL
          OR profile.email ILIKE '%' || v_search || '%'
          OR COALESCE(profile.full_name, '') ILIKE '%' || v_search || '%'
          OR profile.id::TEXT = v_search
      )
    ORDER BY profile.created_at DESC, profile.id
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;
