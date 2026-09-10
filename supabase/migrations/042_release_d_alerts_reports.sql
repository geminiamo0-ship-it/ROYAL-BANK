-- Release D: live alerts and consolidated intelligence reports.

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
            (
                SELECT COUNT(*)
                FROM (
                    SELECT usage.user_id, MIN(usage.consumed_at) AS first_trial_at
                    FROM public.free_trial_block_usage usage
                    GROUP BY usage.user_id
                    HAVING MIN(usage.consumed_at) >= now() - interval '30 days'
                ) AS starters
            ) AS trial_starters_30d,
            (
                SELECT COUNT(*)
                FROM (
                    SELECT usage.user_id, MIN(usage.consumed_at) AS first_trial_at
                    FROM public.free_trial_block_usage usage
                    GROUP BY usage.user_id
                    HAVING MIN(usage.consumed_at) >= now() - interval '30 days'
                ) AS starters
                WHERE EXISTS (
                    SELECT 1
                    FROM public.upgrade_requests request_row
                    WHERE request_row.user_id = starters.user_id
                      AND request_row.status = 'activated'
                      AND request_row.activated_at >= starters.first_trial_at
                )
            ) AS trial_converted_30d
    ),
    alert_rows AS (
        SELECT
            'security:manual-review'::TEXT AS alert_key,
            'critical'::TEXT AS severity,
            'Accounts require manual review'::TEXT AS title,
            format('%s account(s) are blocked behind the manual-review gate.', manual_reviews)::TEXT AS description,
            manual_reviews::NUMERIC AS metric_value,
            '/admin/security'::TEXT AS href
        FROM metrics
        WHERE manual_reviews > 0

        UNION ALL

        SELECT
            'security:high-risk',
            CASE WHEN high_risk >= 5 THEN 'critical' ELSE 'warning' END,
            'High-risk accounts detected',
            format('%s account(s) currently have a risk score of 50 or higher.', high_risk),
            high_risk::NUMERIC,
            '/admin/security'
        FROM metrics
        WHERE high_risk > 0

        UNION ALL

        SELECT
            'security:suspicious-logins',
            'warning',
            'Suspicious login activity',
            format('%s suspicious login(s) were recorded in the last 24 hours.', suspicious_logins_24h),
            suspicious_logins_24h::NUMERIC,
            '/admin/security'
        FROM metrics
        WHERE suspicious_logins_24h > 0

        UNION ALL

        SELECT
            'security:event-spike',
            'warning',
            'Exam security event spike',
            format('%s exam security events occurred in the last hour.', security_events_1h),
            security_events_1h::NUMERIC,
            '/admin/security'
        FROM metrics
        WHERE security_events_1h >= 10

        UNION ALL

        SELECT
            'operations:paid-waiting',
            'critical',
            'Paid users awaiting activation',
            format('%s paid upgrade request(s) are still awaiting activation.', paid_waiting),
            paid_waiting::NUMERIC,
            '/support'
        FROM metrics
        WHERE paid_waiting > 0

        UNION ALL

        SELECT
            'operations:stale-upgrades',
            'warning',
            'Upgrade requests are aging',
            format('%s pending/contacted request(s) are older than 24 hours.', stale_upgrade_requests),
            stale_upgrade_requests::NUMERIC,
            '/support'
        FROM metrics
        WHERE stale_upgrade_requests > 0

        UNION ALL

        SELECT
            'product:completion',
            'info',
            'Low session completion rate',
            format(
                'Only %s%% of sessions started in the last 7 days are completed.',
                round(100.0 * completed_sessions_7d / NULLIF(sessions_7d, 0), 1)
            ),
            round(100.0 * completed_sessions_7d / NULLIF(sessions_7d, 0), 1),
            '/admin/product-analytics'
        FROM metrics
        WHERE sessions_7d >= 20
          AND 100.0 * completed_sessions_7d / NULLIF(sessions_7d, 0) < 50

        UNION ALL

        SELECT
            'trial:conversion',
            'info',
            'Trial conversion below target threshold',
            format(
                '30-day starter conversion is %s%% across %s trial starters.',
                round(100.0 * trial_converted_30d / NULLIF(trial_starters_30d, 0), 1),
                trial_starters_30d
            ),
            round(100.0 * trial_converted_30d / NULLIF(trial_starters_30d, 0), 1),
            '/admin/trial-analytics'
        FROM metrics
        WHERE trial_starters_30d >= 10
          AND 100.0 * trial_converted_30d / NULLIF(trial_starters_30d, 0) < 10
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'alert_key', alert_key,
                'severity', severity,
                'title', title,
                'description', description,
                'metric_value', metric_value,
                'href', href,
                'observed_at', now()
            )
            ORDER BY
                CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
                alert_key
        ),
        '[]'::jsonb
    )
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

REVOKE ALL ON FUNCTION public.admin_get_intelligence_alerts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_intelligence_report(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_intelligence_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_intelligence_report(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
