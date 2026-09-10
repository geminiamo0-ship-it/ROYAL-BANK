-- Release D: Intelligence
-- Live trial analytics, product analytics, security/risk visibility,
-- consolidated reporting, and actionable alerts. No mock metrics.

CREATE INDEX IF NOT EXISTS idx_free_trial_usage_consumed_user_bank
    ON public.free_trial_block_usage (consumed_at DESC, user_id, question_bank_id);

CREATE INDEX IF NOT EXISTS idx_test_sessions_started_user_bank
    ON public.test_sessions (started_at DESC, user_id, question_bank_id);

CREATE INDEX IF NOT EXISTS idx_user_answers_answered_user
    ON public.user_answers (answered_at DESC, user_id);

CREATE INDEX IF NOT EXISTS idx_login_history_suspicious_time
    ON public.login_history (login_at DESC, user_id)
    WHERE is_suspicious IS TRUE;

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_user_activated
    ON public.upgrade_requests (user_id, activated_at DESC)
    WHERE activated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_get_trial_analytics(
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
    v_daily JSONB := '[]'::jsonb;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    WITH first_trial AS (
        SELECT DISTINCT ON (usage.user_id)
            usage.user_id,
            usage.question_bank_id,
            usage.consumed_at AS first_trial_at
        FROM public.free_trial_block_usage usage
        ORDER BY usage.user_id, usage.consumed_at, usage.id
    ),
    cohort AS (
        SELECT *
        FROM first_trial
        WHERE first_trial_at >= p_from AND first_trial_at < p_to
    ),
    cohort_conversion AS (
        SELECT
            cohort.user_id,
            cohort.question_bank_id,
            cohort.first_trial_at,
            conversion.converted_at
        FROM cohort
        LEFT JOIN LATERAL (
            SELECT MIN(request_row.activated_at) AS converted_at
            FROM public.upgrade_requests request_row
            WHERE request_row.user_id = cohort.user_id
              AND request_row.status = 'activated'
              AND request_row.activated_at >= cohort.first_trial_at
              AND request_row.activated_at < p_to
        ) conversion ON TRUE
    ),
    active_trial_users AS (
        SELECT DISTINCT usage.user_id
        FROM public.free_trial_block_usage usage
        WHERE usage.consumed_at >= p_from AND usage.consumed_at < p_to
    ),
    cumulative_bank_usage AS (
        SELECT usage.user_id, usage.question_bank_id, COUNT(*)::BIGINT AS blocks_used
        FROM public.free_trial_block_usage usage
        JOIN active_trial_users active_user ON active_user.user_id = usage.user_id
        WHERE usage.consumed_at < p_to
        GROUP BY usage.user_id, usage.question_bank_id
    ),
    exhausted AS (
        SELECT DISTINCT bank_usage.user_id
        FROM cumulative_bank_usage bank_usage
        JOIN public.question_banks bank ON bank.id = bank_usage.question_bank_id
        WHERE bank.is_free_trial IS TRUE
          AND bank.free_trial_block_limit IS NOT NULL
          AND bank_usage.blocks_used >= bank.free_trial_block_limit
    )
    SELECT jsonb_build_object(
        'trial_starters', (SELECT COUNT(*) FROM cohort),
        'active_trial_users', (SELECT COUNT(*) FROM active_trial_users),
        'trial_blocks_consumed', (
            SELECT COUNT(*) FROM public.free_trial_block_usage usage
            WHERE usage.consumed_at >= p_from AND usage.consumed_at < p_to
        ),
        'trial_sessions_started', (
            SELECT COUNT(*)
            FROM public.test_sessions session_row
            JOIN public.question_banks bank ON bank.id = session_row.question_bank_id
            WHERE bank.is_free_trial IS TRUE
              AND session_row.started_at >= p_from AND session_row.started_at < p_to
        ),
        'trial_questions_answered', (
            SELECT COUNT(*)
            FROM public.user_answers answer_row
            JOIN public.test_sessions session_row ON session_row.id = answer_row.test_session_id
            JOIN public.question_banks bank ON bank.id = session_row.question_bank_id
            WHERE bank.is_free_trial IS TRUE
              AND answer_row.answered_at >= p_from AND answer_row.answered_at < p_to
        ),
        'exhausted_trial_users', (SELECT COUNT(*) FROM exhausted),
        'converted_users', (SELECT COUNT(*) FROM cohort_conversion WHERE converted_at IS NOT NULL),
        'conversion_rate_percent', (
            SELECT CASE WHEN COUNT(*) = 0 THEN 0
                ELSE round(100.0 * COUNT(*) FILTER (WHERE converted_at IS NOT NULL) / COUNT(*), 1)
            END
            FROM cohort_conversion
        ),
        'avg_hours_to_convert', (
            SELECT round(avg(extract(epoch FROM (converted_at - first_trial_at)) / 3600.0)::NUMERIC, 1)
            FROM cohort_conversion
            WHERE converted_at IS NOT NULL
        )
    ) INTO v_summary;

    WITH first_trial AS (
        SELECT DISTINCT ON (usage.user_id)
            usage.user_id,
            usage.question_bank_id,
            usage.consumed_at AS first_trial_at
        FROM public.free_trial_block_usage usage
        ORDER BY usage.user_id, usage.consumed_at, usage.id
    ),
    cohort AS (
        SELECT * FROM first_trial
        WHERE first_trial_at >= p_from AND first_trial_at < p_to
    ),
    bank_rows AS (
        SELECT
            bank.id,
            bank.name,
            bank.free_trial_block_limit,
            bank.free_trial_question_limit,
            COUNT(DISTINCT cohort.user_id)::BIGINT AS starters,
            COUNT(DISTINCT usage.user_id)::BIGINT AS active_users,
            COUNT(usage.id)::BIGINT AS blocks_consumed,
            COUNT(DISTINCT cohort.user_id) FILTER (
                WHERE EXISTS (
                    SELECT 1
                    FROM public.upgrade_requests request_row
                    WHERE request_row.user_id = cohort.user_id
                      AND request_row.status = 'activated'
                      AND request_row.activated_at >= cohort.first_trial_at
                      AND request_row.activated_at < p_to
                )
            )::BIGINT AS converted_users
        FROM public.question_banks bank
        LEFT JOIN cohort ON cohort.question_bank_id = bank.id
        LEFT JOIN public.free_trial_block_usage usage
          ON usage.question_bank_id = bank.id
         AND usage.consumed_at >= p_from
         AND usage.consumed_at < p_to
        WHERE bank.is_free_trial IS TRUE
        GROUP BY bank.id, bank.name, bank.free_trial_block_limit, bank.free_trial_question_limit
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'bank_id', row_data.id,
                'bank_name', row_data.name,
                'block_limit', row_data.free_trial_block_limit,
                'question_limit', row_data.free_trial_question_limit,
                'starters', row_data.starters,
                'active_users', row_data.active_users,
                'blocks_consumed', row_data.blocks_consumed,
                'converted_users', row_data.converted_users,
                'conversion_rate_percent', CASE WHEN row_data.starters = 0 THEN 0
                    ELSE round(100.0 * row_data.converted_users / row_data.starters, 1)
                END
            )
            ORDER BY row_data.active_users DESC, row_data.name
        ),
        '[]'::jsonb
    ) INTO v_by_bank
    FROM bank_rows row_data;

    WITH days AS (
        SELECT generate_series(
            date_trunc('day', p_from),
            date_trunc('day', p_to - interval '1 microsecond'),
            interval '1 day'
        ) AS day_start
    ),
    first_trial AS (
        SELECT usage.user_id, MIN(usage.consumed_at) AS first_trial_at
        FROM public.free_trial_block_usage usage
        GROUP BY usage.user_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'date', day_start::date,
                'active_users', (
                    SELECT COUNT(DISTINCT usage.user_id)
                    FROM public.free_trial_block_usage usage
                    WHERE usage.consumed_at >= day_start
                      AND usage.consumed_at < day_start + interval '1 day'
                ),
                'new_starters', (
                    SELECT COUNT(*)
                    FROM first_trial first_row
                    WHERE first_row.first_trial_at >= day_start
                      AND first_row.first_trial_at < day_start + interval '1 day'
                ),
                'blocks_consumed', (
                    SELECT COUNT(*)
                    FROM public.free_trial_block_usage usage
                    WHERE usage.consumed_at >= day_start
                      AND usage.consumed_at < day_start + interval '1 day'
                ),
                'conversions', (
                    SELECT COUNT(DISTINCT request_row.user_id)
                    FROM public.upgrade_requests request_row
                    WHERE request_row.status = 'activated'
                      AND request_row.activated_at >= day_start
                      AND request_row.activated_at < day_start + interval '1 day'
                      AND EXISTS (
                          SELECT 1 FROM first_trial first_row
                          WHERE first_row.user_id = request_row.user_id
                            AND first_row.first_trial_at <= request_row.activated_at
                      )
                )
            ) ORDER BY day_start
        ),
        '[]'::jsonb
    ) INTO v_daily
    FROM days;

    RETURN jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'summary', v_summary,
        'by_bank', v_by_bank,
        'daily', v_daily
    );
END;
$$;

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
            WHERE activity_row.occurred_at >= p_from AND activity_row.occurred_at < p_to
        ),
        'returning_users', (
            SELECT COUNT(*) FROM (
                SELECT activity_row.user_id
                FROM activity activity_row
                WHERE activity_row.occurred_at >= p_from AND activity_row.occurred_at < p_to
                GROUP BY activity_row.user_id
                HAVING COUNT(DISTINCT activity_row.occurred_at::date) >= 2
            ) returning
        ),
        'new_users', (
            SELECT COUNT(*) FROM public.profiles profile
            WHERE profile.role = 'student'
              AND profile.created_at >= p_from AND profile.created_at < p_to
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
    ) session_rows;

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

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'user_id', state.user_id,
            'full_name', profile.full_name,
            'email', profile.email,
            'is_active', profile.is_active,
            'risk_score', state.risk_score,
            'severity', CASE
                WHEN state.risk_score >= 70 OR state.manual_review_required THEN 'critical'
                WHEN state.risk_score >= 50 THEN 'high'
                WHEN state.risk_score >= 20 THEN 'medium'
                ELSE 'low'
            END,
            'manual_review_required', state.manual_review_required,
            'manual_review_reason', state.manual_review_reason,
            'question_blocked_until', state.question_blocked_until,
            'question_block_reason', state.question_block_reason,
            'session_create_blocked_until', state.session_create_blocked_until,
            'session_create_block_reason', state.session_create_block_reason,
            'gateway_reject_count', state.gateway_reject_count,
            'gateway_escalation_count', state.gateway_escalation_count,
            'gateway_last_rejected_at', state.gateway_last_rejected_at,
            'gateway_last_escalated_at', state.gateway_last_escalated_at,
            'updated_at', state.updated_at
        ) ORDER BY
            state.manual_review_required DESC,
            state.risk_score DESC,
            state.updated_at DESC
    ), '[]'::jsonb)
    INTO v_accounts
    FROM private.exam_security_account_state state
    LEFT JOIN public.profiles profile ON profile.id = state.user_id
    WHERE state.risk_score > 0
       OR state.manual_review_required IS TRUE
       OR state.question_blocked_until > now()
       OR state.session_create_blocked_until > now()
       OR state.gateway_escalation_count > 0
    LIMIT 200;

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
        SELECT
            event_row.id,
            event_row.event_type,
            event_row.user_id,
            profile.email,
            profile.full_name,
            event_row.question_bank_id,
            bank.name AS bank_name,
            event_row.session_id,
            event_row.occurred_at,
            event_row.metadata
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
        SELECT
            login_row.id,
            login_row.user_id,
            profile.email,
            profile.full_name,
            login_row.ip_address,
            login_row.user_agent,
            login_row.login_at
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

CREATE OR REPLACE FUNCTION public.admin_block_ip(
    p_ip INET,
    p_reason TEXT
)
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
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_ip IS NULL THEN
        RAISE EXCEPTION 'IP_REQUIRED';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'BLOCK_REASON_REQUIRED';
    END IF;

    INSERT INTO public.ip_blocklist(ip_address, reason, blocked_by, blocked_at)
    VALUES (p_ip, v_reason, auth.uid(), timezone('utc'::text, now()))
    ON CONFLICT (ip_address) DO UPDATE
    SET
        reason = EXCLUDED.reason,
        blocked_by = auth.uid(),
        blocked_at = timezone('utc'::text, now())
    RETURNING * INTO v_row;

    PERFORM private.business_audit(
        'security_ip_blocked',
        'ip_blocklist',
        v_row.id::TEXT,
        jsonb_build_object('ip_address', v_row.ip_address, 'reason', v_reason)
    );

    RETURN jsonb_build_object(
        'id', v_row.id,
        'ip_address', v_row.ip_address,
        'reason', v_row.reason,
        'blocked_at', v_row.blocked_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unblock_ip(
    p_ip INET,
    p_reason TEXT
)
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
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_ip IS NULL THEN
        RAISE EXCEPTION 'IP_REQUIRED';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'UNBLOCK_REASON_REQUIRED';
    END IF;

    DELETE FROM public.ip_blocklist
    WHERE ip_address = p_ip
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'IP_BLOCK_NOT_FOUND';
    END IF;

    PERFORM private.business_audit(
        'security_ip_unblocked',
        'ip_blocklist',
        v_row.id::TEXT,
        jsonb_build_object('ip_address', v_row.ip_address, 'reason', v_reason)
    );

    RETURN jsonb_build_object(
        'id', v_row.id,
        'ip_address', v_row.ip_address,
        'status', 'unblocked'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_manual_review(
    p_user_id UUID,
    p_required BOOLEAN,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_state private.exam_security_account_state%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'USER_NOT_FOUND';
    END IF;
    IF p_required IS NULL THEN
        RAISE EXCEPTION 'REVIEW_STATE_REQUIRED';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'REVIEW_REASON_REQUIRED';
    END IF;

    INSERT INTO private.exam_security_account_state(
        user_id,
        manual_review_required,
        manual_review_reason,
        risk_score,
        updated_at
    ) VALUES (
        p_user_id,
        p_required,
        CASE WHEN p_required THEN v_reason ELSE NULL END,
        0,
        clock_timestamp()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        manual_review_required = EXCLUDED.manual_review_required,
        manual_review_reason = EXCLUDED.manual_review_reason,
        updated_at = clock_timestamp()
    RETURNING * INTO v_state;

    PERFORM private.business_audit(
        CASE WHEN p_required THEN 'security_manual_review_required' ELSE 'security_manual_review_cleared' END,
        'user',
        p_user_id::TEXT,
        jsonb_build_object('reason', v_reason, 'risk_score', v_state.risk_score)
    );

    RETURN jsonb_build_object(
        'user_id', v_state.user_id,
        'manual_review_required', v_state.manual_review_required,
        'manual_review_reason', v_state.manual_review_reason,
        'risk_score', v_state.risk_score,
        'updated_at', v_state.updated_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_intelligence_alerts()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_alerts JSONB := '[]'::jsonb;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    WITH metrics AS (
        SELECT
            (SELECT COUNT(*) FROM private.exam_security_account_state WHERE manual_review_required IS TRUE) AS manual_reviews,
            (SELECT COUNT(*) FROM private.exam_security_account_state WHERE risk_score >= 50) AS high_risk,
            (SELECT COUNT(*) FROM public.login_history WHERE is_suspicious IS TRUE AND login_at >= now() - interval '24 hours') AS suspicious_logins_24h,
            (SELECT COUNT(*) FROM private.exam_security_events WHERE occurred_at >= now() - interval '1 hour') AS security_events_1h,
            (SELECT COUNT(*) FROM public.upgrade_requests WHERE status = 'paid') AS paid_waiting,
            (SELECT COUNT(*) FROM public.upgrade_requests WHERE status IN ('pending','contacted') AND created_at < now() - interval '24 hours') AS stale_upgrade_requests,
            (SELECT COUNT(*) FROM public.test_sessions WHERE started_at >= now() - interval '7 days') AS sessions_7d,
            (SELECT COUNT(*) FROM public.test_sessions WHERE started_at >= now() - interval '7 days' AND is_completed IS TRUE) AS completed_sessions_7d,
            (SELECT COUNT(*) FROM public.free_trial_block_usage WHERE consumed_at >= now() - interval '30 days') AS trial_usage_30d,
            (
                SELECT COUNT(*) FROM (
                    SELECT usage.user_id, MIN(usage.consumed_at) AS first_trial_at
                    FROM public.free_trial_block_usage usage
                    GROUP BY usage.user_id
                    HAVING MIN(usage.consumed_at) >= now() - interval '30 days'
                ) starters
            ) AS trial_starters_30d,
            (
                SELECT COUNT(*) FROM (
                    SELECT usage.user_id, MIN(usage.consumed_at) AS first_trial_at
                    FROM public.free_trial_block_usage usage
                    GROUP BY usage.user_id
                    HAVING MIN(usage.consumed_at) >= now() - interval '30 days'
                ) starters
                WHERE EXISTS (
                    SELECT 1 FROM public.upgrade_requests request_row
                    WHERE request_row.user_id = starters.user_id
                      AND request_row.status = 'activated'
                      AND request_row.activated_at >= starters.first_trial_at
                )
            ) AS trial_converted_30d
    ),
    alert_rows AS (
        SELECT 'security:manual-review'::TEXT AS alert_key,
               'critical'::TEXT AS severity,
               'Accounts require manual review'::TEXT AS title,
               format('%s account(s) are blocked behind the manual-review gate.', manual_reviews)::TEXT AS description,
               manual_reviews::NUMERIC AS metric_value,
               '/admin/security'::TEXT AS href
        FROM metrics WHERE manual_reviews > 0

        UNION ALL
        SELECT 'security:high-risk', CASE WHEN high_risk >= 5 THEN 'critical' ELSE 'warning' END,
               'High-risk accounts detected',
               format('%s account(s) currently have a risk score of 50 or higher.', high_risk),
               high_risk::NUMERIC, '/admin/security'
        FROM metrics WHERE high_risk > 0

        UNION ALL
        SELECT 'security:suspicious-logins', 'warning',
               'Suspicious login activity',
               format('%s suspicious login(s) were recorded in the last 24 hours.', suspicious_logins_24h),
               suspicious_logins_24h::NUMERIC, '/admin/security'
        FROM metrics WHERE suspicious_logins_24h > 0

        UNION ALL
        SELECT 'security:event-spike', 'warning',
               'Exam security event spike',
               format('%s exam security events occurred in the last hour.', security_events_1h),
               security_events_1h::NUMERIC, '/admin/security'
        FROM metrics WHERE security_events_1h >= 10

        UNION ALL
        SELECT 'operations:paid-waiting', 'critical',
               'Paid users awaiting activation',
               format('%s paid upgrade request(s) are still awaiting activation.', paid_waiting),
               paid_waiting::NUMERIC, '/support'
        FROM metrics WHERE paid_waiting > 0

        UNION ALL
        SELECT 'operations:stale-upgrades', 'warning',
               'Upgrade requests are aging',
               format('%s pending/contacted request(s) are older than 24 hours.', stale_upgrade_requests),
               stale_upgrade_requests::NUMERIC, '/support'
        FROM metrics WHERE stale_upgrade_requests > 0

        UNION ALL
        SELECT 'product:completion', 'info',
               'Low session completion rate',
               format('Only %s%% of sessions started in the last 7 days are completed.',
                   round(100.0 * completed_sessions_7d / NULLIF(sessions_7d, 0), 1)),
               round(100.0 * completed_sessions_7d / NULLIF(sessions_7d, 0), 1), '/admin/product-analytics'
        FROM metrics
        WHERE sessions_7d >= 20
          AND 100.0 * completed_sessions_7d / NULLIF(sessions_7d, 0) < 50

        UNION ALL
        SELECT 'trial:conversion', 'info',
               'Trial conversion below target threshold',
               format('30-day starter conversion is %s%% across %s trial starters.',
                   round(100.0 * trial_converted_30d / NULLIF(trial_starters_30d, 0), 1), trial_starters_30d),
               round(100.0 * trial_converted_30d / NULLIF(trial_starters_30d, 0), 1), '/admin/trial-analytics'
        FROM metrics
        WHERE trial_starters_30d >= 10
          AND 100.0 * trial_converted_30d / NULLIF(trial_starters_30d, 0) < 10
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'alert_key', alert_key,
            'severity', severity,
            'title', title,
            'description', description,
            'metric_value', metric_value,
            'href', href,
            'observed_at', now()
        ) ORDER BY
            CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
            alert_key
    ), '[]'::jsonb)
    INTO v_alerts
    FROM alert_rows;

    RETURN v_alerts;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_intelligence_report(
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
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    RETURN jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'generated_at', now(),
        'trial', public.admin_get_trial_analytics(p_from, p_to),
        'product', public.admin_get_product_analytics(p_from, p_to),
        'security', public.admin_get_security_risk(p_from, p_to),
        'support', public.admin_get_support_performance(p_from, p_to),
        'revenue', public.admin_get_revenue_summary(p_from, p_to),
        'alerts', public.admin_get_intelligence_alerts()
    );
END;
$$;

-- Force security mutations through audited RPCs rather than direct client table writes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ip_blocklist FROM authenticated;

REVOKE ALL ON FUNCTION public.admin_get_trial_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_security_risk(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_block_ip(INET, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_unblock_ip(INET, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_manual_review(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_intelligence_alerts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_intelligence_report(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_trial_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_security_risk(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_block_ip(INET, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unblock_ip(INET, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_manual_review(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_intelligence_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_intelligence_report(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
