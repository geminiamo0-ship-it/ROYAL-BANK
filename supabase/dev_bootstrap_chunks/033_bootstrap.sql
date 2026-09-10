SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

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

-- Release E: durable catalog, plan pricing, unified access resolution, and self-service upgrade requests.
-- Payment verification and access activation intentionally remain manual Support operations.

CREATE TABLE public.catalog_products (
    id BIGSERIAL PRIMARY KEY,
    product_type TEXT NOT NULL CHECK (product_type IN ('global', 'pathway', 'bank')),
    pathway_id BIGINT REFERENCES public.pathways(id) ON DELETE CASCADE,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'hidden', 'archived')),
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    show_prices BOOLEAN NOT NULL DEFAULT FALSE,
    scope_description TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT catalog_products_scope_shape CHECK (
        (product_type = 'global' AND pathway_id IS NULL AND question_bank_id IS NULL)
        OR (product_type = 'pathway' AND pathway_id IS NOT NULL AND question_bank_id IS NULL)
        OR (product_type = 'bank' AND pathway_id IS NULL AND question_bank_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX catalog_products_global_uidx
    ON public.catalog_products ((1))
    WHERE product_type = 'global';

CREATE UNIQUE INDEX catalog_products_pathway_uidx
    ON public.catalog_products (pathway_id)
    WHERE product_type = 'pathway';

CREATE UNIQUE INDEX catalog_products_bank_uidx
    ON public.catalog_products (question_bank_id)
    WHERE product_type = 'bank';

CREATE INDEX catalog_products_status_order_idx
    ON public.catalog_products (status, display_order, id);

CREATE TABLE public.catalog_plans (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    duration_months INTEGER CHECK (duration_months IS NULL OR duration_months BETWEEN 1 AND 120),
    price NUMERIC(12,2) CHECK (price IS NULL OR price > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    show_price BOOLEAN NOT NULL DEFAULT FALSE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_recommended BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT catalog_plans_visible_price_requires_value CHECK (NOT show_price OR price IS NOT NULL)
);

CREATE UNIQUE INDEX catalog_plans_live_duration_currency_uidx
    ON public.catalog_plans (product_id, COALESCE(duration_months, 0), currency)
    WHERE status <> 'archived';

CREATE INDEX catalog_plans_product_status_order_idx
    ON public.catalog_plans (product_id, status, display_order, id);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.catalog_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.catalog_products FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.catalog_plans FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SEQUENCE public.catalog_products_id_seq FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SEQUENCE public.catalog_plans_id_seq FROM PUBLIC, anon, authenticated;

CREATE TRIGGER catalog_products_touch_updated_at
BEFORE UPDATE ON public.catalog_products
FOR EACH ROW EXECUTE FUNCTION private.business_touch_updated_at();

CREATE TRIGGER catalog_plans_touch_updated_at
BEFORE UPDATE ON public.catalog_plans
FOR EACH ROW EXECUTE FUNCTION private.business_touch_updated_at();

ALTER TABLE public.upgrade_requests
    ADD COLUMN catalog_product_id BIGINT REFERENCES public.catalog_products(id) ON DELETE SET NULL,
    ADD COLUMN catalog_plan_id BIGINT REFERENCES public.catalog_plans(id) ON DELETE SET NULL,
    ADD COLUMN quote_snapshot JSONB,
    ADD COLUMN replaced_request_id UUID REFERENCES public.upgrade_requests(id) ON DELETE SET NULL;

CREATE INDEX upgrade_requests_catalog_product_idx
    ON public.upgrade_requests (catalog_product_id, created_at DESC)
    WHERE catalog_product_id IS NOT NULL;

CREATE INDEX upgrade_requests_catalog_plan_idx
    ON public.upgrade_requests (catalog_plan_id)
    WHERE catalog_plan_id IS NOT NULL;

CREATE INDEX upgrade_requests_replaced_request_idx
    ON public.upgrade_requests (replaced_request_id)
    WHERE replaced_request_id IS NOT NULL;

-- Keep one open request per catalog product and user. Replacement cancels the old request first.
CREATE UNIQUE INDEX upgrade_requests_open_catalog_product_uidx
    ON public.upgrade_requests (user_id, catalog_product_id)
    WHERE catalog_product_id IS NOT NULL
      AND status IN ('pending', 'contacted', 'paid');

-- Seed every existing Royal scope. Prices start hidden and nullable so no commercial amount is invented.
-- Existing manual Support pricing continues to work until Admin publishes catalog prices.
INSERT INTO public.catalog_products (
    product_type, name, status, display_order, show_prices, scope_description
)
VALUES (
    'global', 'Royal Global Access', 'active', 0, FALSE, 'Access to every Royal pathway and question bank.'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.catalog_products (
    product_type, pathway_id, name, status, display_order, show_prices, scope_description
)
SELECT
    'pathway', p.id, p.name, 'active', COALESCE(p.display_order, 0) + 100, FALSE,
    'Full access to the ' || p.name || ' pathway.'
FROM public.pathways p
ON CONFLICT DO NOTHING;

INSERT INTO public.catalog_products (
    product_type, question_bank_id, name, status, display_order, show_prices, scope_description
)
SELECT
    'bank', b.id, b.name, 'active', COALESCE(b.display_order, 0) + 1000, FALSE,
    'Premium access to the ' || b.name || ' question bank.'
FROM public.question_banks b
ON CONFLICT DO NOTHING;

INSERT INTO public.catalog_plans (
    product_id, name, duration_months, price, currency, status, show_price,
    is_default, is_recommended, display_order
)
SELECT
    product.id,
    plan_row.name,
    plan_row.duration_months,
    NULL,
    'EGP',
    'active',
    FALSE,
    plan_row.is_default,
    plan_row.is_recommended,
    plan_row.display_order
FROM public.catalog_products product
CROSS JOIN (
    VALUES
        ('1 Month'::TEXT, 1::INTEGER, FALSE, FALSE, 10::INTEGER),
        ('3 Months'::TEXT, 3::INTEGER, FALSE, FALSE, 20::INTEGER),
        ('6 Months'::TEXT, 6::INTEGER, TRUE, TRUE, 30::INTEGER),
        ('12 Months'::TEXT, 12::INTEGER, FALSE, FALSE, 40::INTEGER),
        ('Lifetime'::TEXT, NULL::INTEGER, FALSE, FALSE, 50::INTEGER)
) AS plan_row(name, duration_months, is_default, is_recommended, display_order)
ON CONFLICT DO NOTHING;

-- Associate historical requests with the matching product without inventing a plan or quote snapshot.
UPDATE public.upgrade_requests request_row
SET catalog_product_id = product.id
FROM public.catalog_products product
WHERE request_row.catalog_product_id IS NULL
  AND (
      (request_row.scope_type = 'global' AND product.product_type = 'global')
      OR (
          request_row.scope_type = 'pathway'
          AND product.product_type = 'pathway'
          AND product.pathway_id = request_row.pathway_id
      )
      OR (
          request_row.scope_type = 'bank'
          AND product.product_type = 'bank'
          AND product.question_bank_id = request_row.question_bank_id
      )
  );

CREATE OR REPLACE FUNCTION private.catalog_sync_pathway_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    INSERT INTO public.catalog_products (
        product_type, pathway_id, name, status, display_order, show_prices, scope_description
    ) VALUES (
        'pathway', NEW.id, NEW.name, 'draft', COALESCE(NEW.display_order, 0) + 100, FALSE,
        'Full access to the ' || NEW.name || ' pathway.'
    )
    ON CONFLICT (pathway_id) WHERE product_type = 'pathway'
    DO UPDATE SET name = EXCLUDED.name;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.catalog_sync_bank_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    INSERT INTO public.catalog_products (
        product_type, question_bank_id, name, status, display_order, show_prices, scope_description
    ) VALUES (
        'bank', NEW.id, NEW.name, 'draft', COALESCE(NEW.display_order, 0) + 1000, FALSE,
        'Premium access to the ' || NEW.name || ' question bank.'
    )
    ON CONFLICT (question_bank_id) WHERE product_type = 'bank'
    DO UPDATE SET name = EXCLUDED.name;
    RETURN NEW;
END;
$$;

CREATE TRIGGER pathways_sync_catalog_product
AFTER INSERT OR UPDATE OF name ON public.pathways
FOR EACH ROW EXECUTE FUNCTION private.catalog_sync_pathway_product();

CREATE TRIGGER question_banks_sync_catalog_product
AFTER INSERT OR UPDATE OF name ON public.question_banks
FOR EACH ROW EXECUTE FUNCTION private.catalog_sync_bank_product();
