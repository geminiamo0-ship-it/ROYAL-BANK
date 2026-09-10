CREATE INDEX IF NOT EXISTS idx_upgrade_requests_user_activated
    ON public.upgrade_requests (user_id, activated_at DESC)
    WHERE activated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_get_product_analytics(
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_summary JSONB;
    v_by_bank JSONB := '[]'::jsonb;
    v_session_types JSONB := '[]'::jsonb;
    v_daily JSONB := '[]'::jsonb;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    WITH activity AS (
        SELECT session_row.user_id, session_row.started_at AS occurred_at
        FROM public.test_sessions session_row
        UNION ALL
        SELECT answer_row.user_id, answer_row.answered_at
        FROM public.user_answers answer_row
    ),
    cohort AS (
        SELECT profile.id, profile.created_at
        FROM public.profiles profile
        WHERE profile.role = 'student'
          AND profile.created_at >= p_from
          AND profile.created_at < p_to - interval '7 days'
    ),
    retained AS (
        SELECT cohort.id
        FROM cohort
        WHERE EXISTS (
            SELECT 1
            FROM activity activity_row
            WHERE activity_row.user_id = cohort.id
              AND activity_row.occurred_at >= cohort.created_at + interval '7 days'
              AND activity_row.occurred_at < LEAST(cohort.created_at + interval '14 days', p_to)
        )
    )
    SELECT jsonb_build_object(
        'dau', (
            SELECT COUNT(DISTINCT activity_row.user_id)
            FROM activity activity_row
            WHERE activity_row.occurred_at >= p_to - interval '1 day'
              AND activity_row.occurred_at < p_to
        ),
        'wau', (
            SELECT COUNT(DISTINCT activity_row.user_id)
            FROM activity activity_row
            WHERE activity_row.occurred_at >= p_to - interval '7 days'
              AND activity_row.occurred_at < p_to
        ),
        'mau', (
            SELECT COUNT(DISTINCT activity_row.user_id)
            FROM activity activity_row
            WHERE activity_row.occurred_at >= p_to - interval '30 days'
              AND activity_row.occurred_at < p_to
        ),
        'active_users', (
            SELECT COUNT(DISTINCT activity_row.user_id)
            FROM activity activity_row
            WHERE activity_row.occurred_at >= p_from
              AND activity_row.occurred_at < p_to
        ),
        'returning_users', (
            SELECT COUNT(*) FROM (
                SELECT activity_row.user_id
                FROM activity activity_row
                WHERE activity_row.occurred_at >= p_from
                  AND activity_row.occurred_at < p_to
                GROUP BY activity_row.user_id
                HAVING COUNT(DISTINCT activity_row.occurred_at::date) >= 2
            ) AS returning_rows
        ),
        'new_users', (
            SELECT COUNT(*) FROM public.profiles profile
            WHERE profile.role = 'student'
              AND profile.created_at >= p_from
              AND profile.created_at < p_to
        ),
        'sessions_started', (
            SELECT COUNT(*) FROM public.test_sessions session_row
            WHERE session_row.started_at >= p_from AND session_row.started_at < p_to
        ),
        'sessions_completed', (
            SELECT COUNT(*) FROM public.test_sessions session_row
            WHERE session_row.started_at >= p_from AND session_row.started_at < p_to
              AND session_row.is_completed IS TRUE
        ),
        'session_completion_rate_percent', (
            SELECT CASE WHEN COUNT(*) = 0 THEN 0
                ELSE round(100.0 * COUNT(*) FILTER (WHERE is_completed IS TRUE) / COUNT(*), 1)
            END
            FROM public.test_sessions session_row
            WHERE session_row.started_at >= p_from AND session_row.started_at < p_to
        ),
        'questions_answered', (
            SELECT COUNT(*) FROM public.user_answers answer_row
            WHERE answer_row.answered_at >= p_from AND answer_row.answered_at < p_to
        ),
        'answer_accuracy_percent', (
            SELECT CASE WHEN COUNT(*) = 0 THEN 0
                ELSE round(100.0 * COUNT(*) FILTER (WHERE is_correct IS TRUE) / COUNT(*), 1)
            END
            FROM public.user_answers answer_row
            WHERE answer_row.answered_at >= p_from AND answer_row.answered_at < p_to
        ),
        'avg_answer_seconds', (
            SELECT round(avg(answer_row.time_spent_seconds)::NUMERIC, 1)
            FROM public.user_answers answer_row
            WHERE answer_row.answered_at >= p_from AND answer_row.answered_at < p_to
        ),
        'retention_7d_cohort', (SELECT COUNT(*) FROM cohort),
        'retained_7d_users', (SELECT COUNT(*) FROM retained),
        'retention_7d_percent', (
            SELECT CASE WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN 0
                ELSE round(100.0 * (SELECT COUNT(*) FROM retained) / (SELECT COUNT(*) FROM cohort), 1)
            END
        )
    ) INTO v_summary;

    WITH bank_rows AS (
        SELECT
            bank.id,
            bank.name,
            COUNT(DISTINCT session_row.user_id)::BIGINT AS active_users,
            COUNT(DISTINCT session_row.id)::BIGINT AS sessions_started,
            COUNT(DISTINCT session_row.id) FILTER (WHERE session_row.is_completed IS TRUE)::BIGINT AS sessions_completed,
            COUNT(answer_row.id)::BIGINT AS questions_answered,
            COUNT(answer_row.id) FILTER (WHERE answer_row.is_correct IS TRUE)::BIGINT AS correct_answers
        FROM public.question_banks bank
        LEFT JOIN public.test_sessions session_row
          ON session_row.question_bank_id = bank.id
         AND session_row.started_at >= p_from
         AND session_row.started_at < p_to
        LEFT JOIN public.user_answers answer_row
          ON answer_row.test_session_id = session_row.id
         AND answer_row.answered_at >= p_from
         AND answer_row.answered_at < p_to
        GROUP BY bank.id, bank.name
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'bank_id', row_data.id,
            'bank_name', row_data.name,
            'active_users', row_data.active_users,
            'sessions_started', row_data.sessions_started,
            'sessions_completed', row_data.sessions_completed,
            'completion_rate_percent', CASE WHEN row_data.sessions_started = 0 THEN 0
                ELSE round(100.0 * row_data.sessions_completed / row_data.sessions_started, 1)
            END,
            'questions_answered', row_data.questions_answered,
            'accuracy_percent', CASE WHEN row_data.questions_answered = 0 THEN 0
                ELSE round(100.0 * row_data.correct_answers / row_data.questions_answered, 1)
            END
        ) ORDER BY row_data.active_users DESC, row_data.name
    ), '[]'::jsonb)
    INTO v_by_bank
    FROM bank_rows row_data;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'session_type', session_type,
            'sessions', sessions,
            'completed', completed,
            'completion_rate_percent', CASE WHEN sessions = 0 THEN 0
                ELSE round(100.0 * completed / sessions, 1)
            END
        ) ORDER BY sessions DESC, session_type
    ), '[]'::jsonb)
    INTO v_session_types
    FROM (
        SELECT
            COALESCE(session_row.session_type, 'unspecified') AS session_type,
            COUNT(*)::BIGINT AS sessions,
            COUNT(*) FILTER (WHERE session_row.is_completed IS TRUE)::BIGINT AS completed
        FROM public.test_sessions session_row
        WHERE session_row.started_at >= p_from AND session_row.started_at < p_to
        GROUP BY COALESCE(session_row.session_type, 'unspecified')
    ) AS session_rows;

    WITH days AS (
        SELECT generate_series(
            date_trunc('day', p_from),
            date_trunc('day', p_to - interval '1 microsecond'),
            interval '1 day'
        ) AS day_start
    ),
    daily_activity AS (
        SELECT session_row.user_id, session_row.started_at AS occurred_at
        FROM public.test_sessions session_row
        WHERE session_row.started_at >= p_from AND session_row.started_at < p_to
        UNION ALL
        SELECT answer_row.user_id, answer_row.answered_at
        FROM public.user_answers answer_row
        WHERE answer_row.answered_at >= p_from AND answer_row.answered_at < p_to
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'date', day_start::date,
            'active_users', (
                SELECT COUNT(DISTINCT activity_row.user_id)
                FROM daily_activity activity_row
                WHERE activity_row.occurred_at >= day_start
                  AND activity_row.occurred_at < day_start + interval '1 day'
            ),
            'sessions_started', (
                SELECT COUNT(*) FROM public.test_sessions session_row
                WHERE session_row.started_at >= day_start
                  AND session_row.started_at < day_start + interval '1 day'
            ),
            'questions_answered', (
                SELECT COUNT(*) FROM public.user_answers answer_row
                WHERE answer_row.answered_at >= day_start
                  AND answer_row.answered_at < day_start + interval '1 day'
            ),
            'accuracy_percent', (
                SELECT CASE WHEN COUNT(*) = 0 THEN 0
                    ELSE round(100.0 * COUNT(*) FILTER (WHERE is_correct IS TRUE) / COUNT(*), 1)
                END
                FROM public.user_answers answer_row
                WHERE answer_row.answered_at >= day_start
                  AND answer_row.answered_at < day_start + interval '1 day'
            )
        ) ORDER BY day_start
    ), '[]'::jsonb)
    INTO v_daily
    FROM days;

    RETURN jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'summary', v_summary,
        'by_bank', v_by_bank,
        'session_types', v_session_types,
        'daily', v_daily
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_security_risk(
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_summary JSONB;
    v_accounts JSONB := '[]'::jsonb;
    v_event_types JSONB := '[]'::jsonb;
    v_recent_events JSONB := '[]'::jsonb;
    v_suspicious_logins JSONB := '[]'::jsonb;
    v_blocked_ips JSONB := '[]'::jsonb;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    SELECT jsonb_build_object(
        'manual_review_accounts', COUNT(*) FILTER (WHERE state.manual_review_required IS TRUE),
        'high_risk_accounts', COUNT(*) FILTER (WHERE state.risk_score >= 50),
        'medium_risk_accounts', COUNT(*) FILTER (WHERE state.risk_score >= 20 AND state.risk_score < 50),
        'currently_question_blocked', COUNT(*) FILTER (WHERE state.question_blocked_until > now()),
        'currently_session_blocked', COUNT(*) FILTER (WHERE state.session_create_blocked_until > now()),
        'gateway_escalated_accounts', COUNT(*) FILTER (WHERE state.gateway_escalation_count > 0),
        'security_events', (
            SELECT COUNT(*) FROM private.exam_security_events event_row
            WHERE event_row.occurred_at >= p_from AND event_row.occurred_at < p_to
        ),
        'suspicious_logins', (
            SELECT COUNT(*) FROM public.login_history login_row
            WHERE login_row.is_suspicious IS TRUE
              AND login_row.login_at >= p_from AND login_row.login_at < p_to
        ),
        'blocked_ips', (SELECT COUNT(*) FROM public.ip_blocklist)
    ) INTO v_summary
    FROM private.exam_security_account_state state;

    SELECT COALESCE(jsonb_agg(to_jsonb(account_view) ORDER BY account_view.manual_review_required DESC, account_view.risk_score DESC, account_view.updated_at DESC), '[]'::jsonb)
    INTO v_accounts
    FROM (
        SELECT
            state.user_id,
            profile.full_name,
            profile.email,
            profile.is_active,
            state.risk_score,
            CASE
                WHEN state.risk_score >= 70 OR state.manual_review_required THEN 'critical'
                WHEN state.risk_score >= 50 THEN 'high'
                WHEN state.risk_score >= 20 THEN 'medium'
                ELSE 'low'
            END AS severity,
            state.manual_review_required,
            state.manual_review_reason,
            state.question_blocked_until,
            state.question_block_reason,
            state.session_create_blocked_until,
            state.session_create_block_reason,
            state.gateway_reject_count,
            state.gateway_escalation_count,
            state.gateway_last_rejected_at,
            state.gateway_last_escalated_at,
            state.updated_at
        FROM private.exam_security_account_state state
        LEFT JOIN public.profiles profile ON profile.id = state.user_id
        WHERE state.risk_score > 0
           OR state.manual_review_required IS TRUE
           OR state.question_blocked_until > now()
           OR state.session_create_blocked_until > now()
           OR state.gateway_escalation_count > 0
        ORDER BY state.manual_review_required DESC, state.risk_score DESC, state.updated_at DESC
        LIMIT 200
    ) account_view;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('event_type', event_type, 'count', event_count)
        ORDER BY event_count DESC, event_type
    ), '[]'::jsonb)
    INTO v_event_types
    FROM (
        SELECT event_row.event_type, COUNT(*)::BIGINT AS event_count
        FROM private.exam_security_events event_row
        WHERE event_row.occurred_at >= p_from AND event_row.occurred_at < p_to
        GROUP BY event_row.event_type
    ) event_counts;

    SELECT COALESCE(jsonb_agg(to_jsonb(event_view) ORDER BY event_view.occurred_at DESC), '[]'::jsonb)
    INTO v_recent_events
    FROM (
        SELECT event_row.id, event_row.event_type, event_row.user_id,
               profile.email, profile.full_name,
               event_row.question_bank_id, bank.name AS bank_name,
               event_row.session_id, event_row.occurred_at, event_row.metadata
        FROM private.exam_security_events event_row
        LEFT JOIN public.profiles profile ON profile.id = event_row.user_id
        LEFT JOIN public.question_banks bank ON bank.id = event_row.question_bank_id
        WHERE event_row.occurred_at >= p_from AND event_row.occurred_at < p_to
        ORDER BY event_row.occurred_at DESC, event_row.id DESC
        LIMIT 100
    ) event_view;

    SELECT COALESCE(jsonb_agg(to_jsonb(login_view) ORDER BY login_view.login_at DESC), '[]'::jsonb)
    INTO v_suspicious_logins
    FROM (
        SELECT login_row.id, login_row.user_id, profile.email, profile.full_name,
               login_row.ip_address, login_row.user_agent, login_row.login_at
        FROM public.login_history login_row
        LEFT JOIN public.profiles profile ON profile.id = login_row.user_id
        WHERE login_row.is_suspicious IS TRUE
          AND login_row.login_at >= p_from AND login_row.login_at < p_to
        ORDER BY login_row.login_at DESC, login_row.id DESC
        LIMIT 100
    ) login_view;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', block_row.id,
            'ip_address', block_row.ip_address,
            'reason', block_row.reason,
            'blocked_by', block_row.blocked_by,
            'blocked_by_name', actor.full_name,
            'blocked_at', block_row.blocked_at
        ) ORDER BY block_row.blocked_at DESC, block_row.id DESC
    ), '[]'::jsonb)
    INTO v_blocked_ips
    FROM public.ip_blocklist block_row
    LEFT JOIN public.profiles actor ON actor.id = block_row.blocked_by;

    RETURN jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'summary', v_summary,
        'accounts', v_accounts,
        'event_types', v_event_types,
        'recent_events', v_recent_events,
        'suspicious_logins', v_suspicious_logins,
        'blocked_ips', v_blocked_ips
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_block_ip(p_ip INET, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_row public.ip_blocklist%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED'; END IF;
    IF p_ip IS NULL THEN RAISE EXCEPTION 'IP_REQUIRED'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN RAISE EXCEPTION 'BLOCK_REASON_REQUIRED'; END IF;

    INSERT INTO public.ip_blocklist(ip_address, reason, blocked_by, blocked_at)
    VALUES (p_ip, v_reason, auth.uid(), timezone('utc'::text, now()))
    ON CONFLICT (ip_address) DO UPDATE
    SET reason = EXCLUDED.reason,
        blocked_by = auth.uid(),
        blocked_at = timezone('utc'::text, now())
    RETURNING * INTO v_row;

    PERFORM private.business_audit(
        'security_ip_blocked', 'ip_blocklist', v_row.id::TEXT,
        jsonb_build_object('ip_address', v_row.ip_address, 'reason', v_reason)
    );

    RETURN jsonb_build_object('id', v_row.id, 'ip_address', v_row.ip_address, 'reason', v_row.reason, 'blocked_at', v_row.blocked_at);
END;
$$;
