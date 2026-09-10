BEGIN;

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

CREATE OR REPLACE FUNCTION public.resolve_my_access(
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_scope TEXT := lower(btrim(COALESCE(p_scope_type, '')));
    v_bank_pathway_id BIGINT;
    v_grant public.user_access_grants%ROWTYPE;
    v_total_banks INTEGER := 0;
    v_covered_banks INTEGER := 0;
    v_all_lifetime BOOLEAN := FALSE;
    v_effective_expiry TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    IF v_scope = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSIF v_scope = 'pathway' THEN
        IF p_pathway_id IS NULL OR p_bank_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSIF v_scope = 'bank' THEN
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
        SELECT pathway_id INTO v_bank_pathway_id
        FROM public.question_banks
        WHERE id = p_bank_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSE
        RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
    END IF;

    -- Broader grants win so a narrower redundant extension is never offered.
    IF v_scope IN ('pathway', 'bank') THEN
        SELECT grant_row.*
        INTO v_grant
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = v_user_id
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= now()
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
          AND (
              grant_row.scope_type = 'global'
              OR (
                  v_scope = 'bank'
                  AND grant_row.scope_type = 'pathway'
                  AND grant_row.pathway_id = v_bank_pathway_id
              )
          )
        ORDER BY (grant_row.expires_at IS NULL) DESC, grant_row.expires_at DESC NULLS FIRST, grant_row.id DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'has_access', TRUE,
                'coverage_kind', 'broader',
                'can_extend', FALSE,
                'expires_soon', v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() + interval '30 days',
                'grant_id', v_grant.id,
                'scope_type', v_grant.scope_type,
                'pathway_id', v_grant.pathway_id,
                'question_bank_id', v_grant.question_bank_id,
                'starts_at', v_grant.starts_at,
                'expires_at', v_grant.expires_at,
                'is_lifetime', v_grant.expires_at IS NULL
            );
        END IF;
    END IF;

    SELECT grant_row.*
    INTO v_grant
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = v_user_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      AND (
          (v_scope = 'global' AND grant_row.scope_type = 'global')
          OR (v_scope = 'pathway' AND grant_row.scope_type = 'pathway' AND grant_row.pathway_id = p_pathway_id)
          OR (v_scope = 'bank' AND grant_row.scope_type = 'bank' AND grant_row.question_bank_id = p_bank_id)
      )
    ORDER BY (grant_row.expires_at IS NULL) DESC, grant_row.expires_at DESC NULLS FIRST, grant_row.id DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'has_access', TRUE,
            'coverage_kind', 'exact',
            'can_extend', v_grant.expires_at IS NOT NULL,
            'expires_soon', v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() + interval '30 days',
            'grant_id', v_grant.id,
            'scope_type', v_grant.scope_type,
            'pathway_id', v_grant.pathway_id,
            'question_bank_id', v_grant.question_bank_id,
            'starts_at', v_grant.starts_at,
            'expires_at', v_grant.expires_at,
            'is_lifetime', v_grant.expires_at IS NULL
        );
    END IF;

    -- Preserve the historical Royal behavior where owning every bank in a pathway means the pathway is covered.
    IF v_scope = 'pathway' THEN
        WITH bank_set AS (
            SELECT id
            FROM public.question_banks
            WHERE pathway_id = p_pathway_id
        ),
        bank_coverage AS (
            SELECT
                bank.id,
                bool_or(grant_row.expires_at IS NULL) AS lifetime,
                max(grant_row.expires_at) FILTER (WHERE grant_row.expires_at IS NOT NULL) AS finite_expiry
            FROM bank_set bank
            LEFT JOIN public.user_access_grants grant_row
              ON grant_row.user_id = v_user_id
             AND grant_row.scope_type = 'bank'
             AND grant_row.question_bank_id = bank.id
             AND grant_row.revoked_at IS NULL
             AND grant_row.starts_at <= now()
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
            GROUP BY bank.id
        )
        SELECT
            count(*)::INTEGER,
            count(*) FILTER (WHERE lifetime OR finite_expiry IS NOT NULL)::INTEGER,
            COALESCE(bool_and(lifetime), FALSE),
            min(CASE WHEN lifetime THEN 'infinity'::TIMESTAMPTZ ELSE finite_expiry END)
        INTO v_total_banks, v_covered_banks, v_all_lifetime, v_effective_expiry
        FROM bank_coverage;

        IF v_total_banks > 0 AND v_covered_banks = v_total_banks THEN
            RETURN jsonb_build_object(
                'has_access', TRUE,
                'coverage_kind', 'broader',
                'can_extend', FALSE,
                'expires_soon', NOT v_all_lifetime AND v_effective_expiry <= now() + interval '30 days',
                'grant_id', NULL,
                'scope_type', NULL,
                'pathway_id', p_pathway_id,
                'question_bank_id', NULL,
                'starts_at', NULL,
                'expires_at', CASE WHEN v_all_lifetime THEN NULL ELSE v_effective_expiry END,
                'is_lifetime', v_all_lifetime
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'has_access', FALSE,
        'coverage_kind', 'none',
        'can_extend', FALSE,
        'expires_soon', FALSE,
        'grant_id', NULL,
        'scope_type', NULL,
        'pathway_id', NULL,
        'question_bank_id', NULL,
        'starts_at', NULL,
        'expires_at', NULL,
        'is_lifetime', FALSE
    );
END;
$$;

CREATE OR REPLACE FUNCTION private.catalog_quote(
    p_plan_id BIGINT,
    p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_plan public.catalog_plans%ROWTYPE;
    v_product public.catalog_products%ROWTYPE;
    v_promo public.promo_codes%ROWTYPE;
    v_code TEXT := NULLIF(upper(btrim(COALESCE(p_promo_code, ''))), '');
    v_discount NUMERIC(12,2) := NULL;
    v_final NUMERIC(12,2) := NULL;
    v_price_visible BOOLEAN;
BEGIN
    SELECT * INTO v_plan
    FROM public.catalog_plans
    WHERE id = p_plan_id
      AND status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PLAN_UNAVAILABLE';
    END IF;

    SELECT * INTO v_product
    FROM public.catalog_products
    WHERE id = v_plan.product_id
      AND status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_UNAVAILABLE';
    END IF;

    v_price_visible := v_product.show_prices AND v_plan.show_price AND v_plan.price IS NOT NULL;

    IF v_code IS NOT NULL THEN
        SELECT * INTO v_promo
        FROM public.promo_codes promo
        WHERE upper(promo.code) = v_code
          AND promo.status = 'active'
          AND (promo.valid_from IS NULL OR promo.valid_from <= now())
          AND (promo.valid_until IS NULL OR promo.valid_until > now());

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PROMO_CODE_INVALID';
        END IF;

        IF v_promo.max_activations IS NOT NULL
           AND (
               SELECT count(*)
               FROM public.upgrade_requests request_row
               WHERE request_row.promo_code_id = v_promo.id
                 AND request_row.status = 'activated'
           ) >= v_promo.max_activations THEN
            RAISE EXCEPTION 'PROMO_CODE_LIMIT_REACHED';
        END IF;
    END IF;

    IF v_plan.price IS NOT NULL THEN
        v_discount := 0;
        v_final := v_plan.price;

        IF v_code IS NOT NULL THEN
            IF v_promo.discount_type = 'percentage' THEN
                v_discount := round((v_plan.price * COALESCE(v_promo.discount_value, 0) / 100.0)::NUMERIC, 2);
                v_final := v_plan.price - v_discount;
            ELSIF v_promo.discount_type = 'fixed' THEN
                IF v_promo.discount_currency IS DISTINCT FROM v_plan.currency THEN
                    RAISE EXCEPTION 'PROMO_CURRENCY_MISMATCH';
                END IF;
                v_discount := round(COALESCE(v_promo.discount_value, 0)::NUMERIC, 2);
                v_final := v_plan.price - v_discount;
            ELSIF v_promo.discount_type = 'special_price' THEN
                IF v_promo.discount_currency IS DISTINCT FROM v_plan.currency
                   OR v_promo.discount_value IS NULL
                   OR v_promo.discount_value <= 0
                   OR v_promo.discount_value > v_plan.price THEN
                    RAISE EXCEPTION 'PROMO_SPECIAL_PRICE_INVALID';
                END IF;
                v_final := round(v_promo.discount_value::NUMERIC, 2);
                v_discount := v_plan.price - v_final;
            END IF;
        END IF;

        IF v_final <= 0 THEN
            RAISE EXCEPTION 'PROMO_ZERO_PRICE_NOT_SUPPORTED';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'product_id', v_product.id,
        'product_type', v_product.product_type,
        'pathway_id', v_product.pathway_id,
        'question_bank_id', v_product.question_bank_id,
        'product_name', v_product.name,
        'scope_description', v_product.scope_description,
        'product_show_prices', v_product.show_prices,
        'plan_id', v_plan.id,
        'plan_name', v_plan.name,
        'duration_months', v_plan.duration_months,
        'currency', v_plan.currency,
        'plan_version', v_plan.version,
        'plan_show_price', v_plan.show_price,
        'price_visible', v_price_visible,
        'base_price', v_plan.price,
        'discount_amount', v_discount,
        'final_price', v_final,
        'promo_applied', v_code IS NOT NULL,
        'promo_code_id', CASE WHEN v_code IS NULL THEN NULL ELSE v_promo.id END,
        'promo_code', CASE WHEN v_code IS NULL THEN NULL ELSE v_promo.code END,
        'promo_discount_type', CASE WHEN v_code IS NULL THEN NULL ELSE v_promo.discount_type END,
        'promo_discount_value', CASE WHEN v_code IS NULL THEN NULL ELSE v_promo.discount_value END,
        'promo_discount_currency', CASE WHEN v_code IS NULL THEN NULL ELSE v_promo.discount_currency END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_catalog_quote(
    p_plan_id BIGINT,
    p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_quote JSONB;
    v_visible BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    v_quote := private.catalog_quote(p_plan_id, p_promo_code);
    v_visible := COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE);

    RETURN jsonb_build_object(
        'plan_id', (v_quote->>'plan_id')::BIGINT,
        'plan_name', v_quote->>'plan_name',
        'duration_months', NULLIF(v_quote->>'duration_months', '')::INTEGER,
        'currency', v_quote->>'currency',
        'price_visible', v_visible,
        'base_price', CASE WHEN v_visible THEN NULLIF(v_quote->>'base_price', '')::NUMERIC ELSE NULL END,
        'discount_amount', CASE WHEN v_visible THEN NULLIF(v_quote->>'discount_amount', '')::NUMERIC ELSE NULL END,
        'final_price', CASE WHEN v_visible THEN NULLIF(v_quote->>'final_price', '')::NUMERIC ELSE NULL END,
        'promo_applied', COALESCE((v_quote->>'promo_applied')::BOOLEAN, FALSE),
        'promo_code', v_quote->>'promo_code'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_catalog_upgrade_offer(
    p_scope_type TEXT,
    p_target_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_scope TEXT := lower(btrim(COALESCE(p_scope_type, '')));
    v_product public.catalog_products%ROWTYPE;
    v_access JSONB;
    v_pending public.upgrade_requests%ROWTYPE;
    v_pending_order public.orders%ROWTYPE;
    v_has_payment BOOLEAN := FALSE;
    v_pending_snapshot JSONB;
    v_pending_payload JSONB := NULL;
    v_plans JSONB := '[]'::JSONB;
    v_mode TEXT;
    v_can_request BOOLEAN;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    SELECT * INTO v_product
    FROM public.catalog_products product
    WHERE product.status = 'active'
      AND (
          (v_scope = 'global' AND p_target_id IS NULL AND product.product_type = 'global')
          OR (v_scope = 'pathway' AND product.product_type = 'pathway' AND product.pathway_id = p_target_id)
          OR (v_scope = 'bank' AND product.product_type = 'bank' AND product.question_bank_id = p_target_id)
      )
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_UNAVAILABLE';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.catalog_plans plan_row
        WHERE plan_row.product_id = v_product.id AND plan_row.status = 'active'
    ) THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_UNAVAILABLE';
    END IF;

    v_access := public.resolve_my_access(
        v_scope,
        CASE WHEN v_scope = 'pathway' THEN p_target_id ELSE NULL END,
        CASE WHEN v_scope = 'bank' THEN p_target_id ELSE NULL END
    );

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', plan_row.id,
                'name', plan_row.name,
                'duration_months', plan_row.duration_months,
                'currency', plan_row.currency,
                'price_visible', v_product.show_prices AND plan_row.show_price AND plan_row.price IS NOT NULL,
                'price', CASE WHEN v_product.show_prices AND plan_row.show_price THEN plan_row.price ELSE NULL END,
                'is_default', plan_row.is_default,
                'is_recommended', plan_row.is_recommended,
                'display_order', plan_row.display_order,
                'version', plan_row.version
            )
            ORDER BY plan_row.display_order, plan_row.id
        ),
        '[]'::JSONB
    ) INTO v_plans
    FROM public.catalog_plans plan_row
    WHERE plan_row.product_id = v_product.id
      AND plan_row.status = 'active';

    SELECT request_row.* INTO v_pending
    FROM public.upgrade_requests request_row
    WHERE request_row.user_id = v_user_id
      AND request_row.catalog_product_id = v_product.id
      AND request_row.status IN ('pending', 'contacted', 'paid')
    ORDER BY request_row.created_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_pending_snapshot := v_pending.quote_snapshot;

        SELECT * INTO v_pending_order
        FROM public.orders order_row
        WHERE order_row.upgrade_request_id = v_pending.id;

        IF FOUND THEN
            SELECT EXISTS (
                SELECT 1 FROM public.payments payment
                WHERE payment.order_id = v_pending_order.id
                  AND payment.status = 'confirmed'
                  AND payment.amount > 0
            ) INTO v_has_payment;
        END IF;

        v_pending_payload := jsonb_build_object(
            'request_id', v_pending.id,
            'public_code', v_pending.public_code,
            'status', v_pending.status,
            'catalog_product_id', v_pending.catalog_product_id,
            'catalog_plan_id', v_pending.catalog_plan_id,
            'plan_name', v_pending_snapshot->>'plan_name',
            'duration_months', NULLIF(v_pending_snapshot->>'duration_months', '')::INTEGER,
            'currency', v_pending_snapshot->>'currency',
            'price_visible', COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE),
            'base_price', CASE WHEN COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_pending_snapshot->>'base_price', '')::NUMERIC ELSE NULL END,
            'discount_amount', CASE WHEN COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_pending_snapshot->>'discount_amount', '')::NUMERIC ELSE NULL END,
            'final_price', CASE WHEN COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_pending_snapshot->>'final_price', '')::NUMERIC ELSE NULL END,
            'promo_code', v_pending.promo_code_entered,
            'legacy', v_pending.catalog_plan_id IS NULL OR v_pending.quote_snapshot IS NULL,
            'can_cancel', v_pending.status IN ('pending', 'contacted') AND NOT v_has_payment,
            'can_change', v_pending.status IN ('pending', 'contacted') AND NOT v_has_payment AND v_pending.catalog_plan_id IS NOT NULL AND v_pending.quote_snapshot IS NOT NULL
        );
    END IF;

    IF v_pending_payload IS NOT NULL THEN
        v_mode := 'pending';
        v_can_request := FALSE;
    ELSIF COALESCE((v_access->>'has_access')::BOOLEAN, FALSE) THEN
        IF v_access->>'coverage_kind' = 'exact'
           AND COALESCE((v_access->>'can_extend')::BOOLEAN, FALSE) THEN
            v_mode := 'extension';
            v_can_request := TRUE;
        ELSE
            v_mode := 'active';
            v_can_request := FALSE;
        END IF;
    ELSE
        v_mode := 'upgrade';
        v_can_request := TRUE;
    END IF;

    RETURN jsonb_build_object(
        'product', jsonb_build_object(
            'id', v_product.id,
            'product_type', v_product.product_type,
            'target_id', CASE
                WHEN v_product.product_type = 'pathway' THEN v_product.pathway_id
                WHEN v_product.product_type = 'bank' THEN v_product.question_bank_id
                ELSE NULL
            END,
            'name', v_product.name,
            'scope_description', v_product.scope_description,
            'show_prices', v_product.show_prices
        ),
        'plans', v_plans,
        'access', v_access,
        'pending_request', v_pending_payload,
        'mode', v_mode,
        'can_request', v_can_request
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_catalog_upgrade_request(
    p_plan_id BIGINT,
    p_promo_code TEXT DEFAULT NULL,
    p_replace_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_quote JSONB;
    v_product_id BIGINT;
    v_product_type TEXT;
    v_pathway_id BIGINT;
    v_bank_id BIGINT;
    v_access JSONB;
    v_mode TEXT;
    v_existing public.upgrade_requests%ROWTYPE;
    v_replace public.upgrade_requests%ROWTYPE;
    v_replace_order public.orders%ROWTYPE;
    v_request public.upgrade_requests%ROWTYPE;
    v_public_code TEXT;
    v_attempt INTEGER;
    v_code TEXT := NULLIF(upper(btrim(COALESCE(p_promo_code, ''))), '');
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    v_quote := private.catalog_quote(p_plan_id, v_code);
    v_product_id := (v_quote->>'product_id')::BIGINT;
    v_product_type := v_quote->>'product_type';
    v_pathway_id := NULLIF(v_quote->>'pathway_id', '')::BIGINT;
    v_bank_id := NULLIF(v_quote->>'question_bank_id', '')::BIGINT;

    PERFORM pg_advisory_xact_lock(hashtextextended('royal:catalog-upgrade:' || v_user_id::TEXT || ':' || v_product_id::TEXT, 0));

    v_access := public.resolve_my_access(v_product_type, v_pathway_id, v_bank_id);
    IF COALESCE((v_access->>'has_access')::BOOLEAN, FALSE) THEN
        IF v_access->>'coverage_kind' <> 'exact' THEN
            RAISE EXCEPTION 'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT';
        END IF;
        IF COALESCE((v_access->>'is_lifetime')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION 'ACCESS_ALREADY_LIFETIME';
        END IF;
        v_mode := 'extension';
    ELSE
        v_mode := 'upgrade';
    END IF;

    SELECT request_row.* INTO v_existing
    FROM public.upgrade_requests request_row
    WHERE request_row.user_id = v_user_id
      AND request_row.catalog_product_id = v_product_id
      AND request_row.status IN ('pending', 'contacted', 'paid')
    ORDER BY request_row.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF p_replace_request_id IS NULL AND FOUND THEN
        IF v_existing.catalog_plan_id = p_plan_id
           AND COALESCE(upper(v_existing.promo_code_entered), '') = COALESCE(v_code, '') THEN
            RETURN jsonb_build_object(
                'request_id', v_existing.id,
                'public_code', v_existing.public_code,
                'status', v_existing.status,
                'scope_type', v_existing.scope_type,
                'product_name', COALESCE(v_existing.quote_snapshot->>'product_name', v_quote->>'product_name'),
                'plan_name', v_existing.quote_snapshot->>'plan_name',
                'duration_months', NULLIF(v_existing.quote_snapshot->>'duration_months', '')::INTEGER,
                'currency', v_existing.quote_snapshot->>'currency',
                'price_visible', COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE),
                'base_price', CASE WHEN COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_existing.quote_snapshot->>'base_price', '')::NUMERIC ELSE NULL END,
                'discount_amount', CASE WHEN COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_existing.quote_snapshot->>'discount_amount', '')::NUMERIC ELSE NULL END,
                'final_price', CASE WHEN COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_existing.quote_snapshot->>'final_price', '')::NUMERIC ELSE NULL END,
                'promo_applied', v_existing.promo_code_id IS NOT NULL,
                'existing', TRUE
            );
        END IF;
        RAISE EXCEPTION 'UPGRADE_REQUEST_ALREADY_PENDING';
    END IF;

    IF p_replace_request_id IS NOT NULL THEN
        SELECT request_row.* INTO v_replace
        FROM public.upgrade_requests request_row
        WHERE request_row.id = p_replace_request_id
          AND request_row.user_id = v_user_id
          AND request_row.catalog_product_id = v_product_id
        FOR UPDATE;

        IF NOT FOUND OR v_replace.status NOT IN ('pending', 'contacted') THEN
            RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_REPLACEABLE';
        END IF;

        SELECT * INTO v_replace_order
        FROM public.orders order_row
        WHERE order_row.upgrade_request_id = v_replace.id
        FOR UPDATE;

        IF FOUND AND EXISTS (
            SELECT 1 FROM public.payments payment
            WHERE payment.order_id = v_replace_order.id
              AND payment.status = 'confirmed'
              AND payment.amount > 0
        ) THEN
            RAISE EXCEPTION 'PAID_REQUEST_CANNOT_BE_REPLACED';
        END IF;

        IF v_replace_order.id IS NOT NULL THEN
            UPDATE public.orders
            SET status = 'cancelled'
            WHERE id = v_replace_order.id
              AND status = 'awaiting_payment';
        END IF;

        UPDATE public.upgrade_requests
        SET
            status = 'cancelled',
            cancelled_at = timezone('utc'::text, now()),
            cancelled_by = v_user_id,
            cancel_reason = 'Replaced by customer with a different catalog plan.'
        WHERE id = v_replace.id;
    END IF;

    v_quote := v_quote || jsonb_build_object('mode', v_mode, 'quoted_at', timezone('utc'::text, now()));

    FOR v_attempt IN 1..12 LOOP
        v_public_code := 'RY-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.upgrade_requests WHERE public_code = v_public_code);
        v_public_code := NULL;
    END LOOP;
    IF v_public_code IS NULL THEN
        RAISE EXCEPTION 'REQUEST_CODE_GENERATION_FAILED';
    END IF;

    INSERT INTO public.upgrade_requests (
        public_code, user_id, scope_type, pathway_id, question_bank_id,
        promo_code_id, promo_code_entered, catalog_product_id, catalog_plan_id,
        quote_snapshot, replaced_request_id
    ) VALUES (
        v_public_code,
        v_user_id,
        v_product_type,
        v_pathway_id,
        v_bank_id,
        NULLIF(v_quote->>'promo_code_id', '')::BIGINT,
        v_quote->>'promo_code',
        v_product_id,
        p_plan_id,
        v_quote,
        p_replace_request_id
    )
    RETURNING * INTO v_request;

    PERFORM private.business_audit(
        CASE WHEN v_mode = 'extension' THEN 'catalog_extension_requested' ELSE 'catalog_upgrade_requested' END,
        'upgrade_request',
        v_request.id::TEXT,
        jsonb_build_object(
            'public_code', v_request.public_code,
            'catalog_product_id', v_product_id,
            'catalog_plan_id', p_plan_id,
            'replaced_request_id', p_replace_request_id,
            'promo_code', v_request.promo_code_entered
        )
    );

    RETURN jsonb_build_object(
        'request_id', v_request.id,
        'public_code', v_request.public_code,
        'status', v_request.status,
        'scope_type', v_request.scope_type,
        'product_name', v_quote->>'product_name',
        'plan_name', v_quote->>'plan_name',
        'duration_months', NULLIF(v_quote->>'duration_months', '')::INTEGER,
        'currency', v_quote->>'currency',
        'price_visible', COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE),
        'base_price', CASE WHEN COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_quote->>'base_price', '')::NUMERIC ELSE NULL END,
        'discount_amount', CASE WHEN COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_quote->>'discount_amount', '')::NUMERIC ELSE NULL END,
        'final_price', CASE WHEN COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE) THEN NULLIF(v_quote->>'final_price', '')::NUMERIC ELSE NULL END,
        'promo_applied', NULLIF(v_quote->>'promo_code_id', '') IS NOT NULL,
        'existing', FALSE
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_catalog_upgrade_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    SELECT * INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id
      AND user_id = v_user_id
      AND catalog_product_id IS NOT NULL
    FOR UPDATE;

    IF NOT FOUND OR v_request.status NOT IN ('pending', 'contacted') THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_CANCELLABLE';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE upgrade_request_id = v_request.id
    FOR UPDATE;

    IF FOUND AND EXISTS (
        SELECT 1 FROM public.payments payment
        WHERE payment.order_id = v_order.id
          AND payment.status = 'confirmed'
          AND payment.amount > 0
    ) THEN
        RAISE EXCEPTION 'PAID_REQUEST_CANNOT_BE_CANCELLED';
    END IF;

    IF v_order.id IS NOT NULL THEN
        UPDATE public.orders
        SET status = 'cancelled'
        WHERE id = v_order.id
          AND status = 'awaiting_payment';
    END IF;

    UPDATE public.upgrade_requests
    SET
        status = 'cancelled',
        cancelled_at = timezone('utc'::text, now()),
        cancelled_by = v_user_id,
        cancel_reason = 'Cancelled by customer before payment.'
    WHERE id = v_request.id;

    PERFORM private.business_audit(
        'catalog_upgrade_cancelled_by_customer',
        'upgrade_request',
        v_request.id::TEXT,
        jsonb_build_object('public_code', v_request.public_code, 'catalog_product_id', v_request.catalog_product_id)
    );

    RETURN jsonb_build_object('request_id', v_request.id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_catalog_overview()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_global JSONB;
    v_pathways JSONB;
    v_banks JSONB;
    v_access JSONB;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    v_access := public.resolve_my_access('global', NULL, NULL);
    SELECT jsonb_build_object(
        'access', v_access,
        'catalog_available', EXISTS (
            SELECT 1
            FROM public.catalog_products product
            WHERE product.product_type = 'global'
              AND product.status = 'active'
              AND EXISTS (SELECT 1 FROM public.catalog_plans plan_row WHERE plan_row.product_id = product.id AND plan_row.status = 'active')
        )
    ) INTO v_global;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', pathway.id,
                'access', public.resolve_my_access('pathway', pathway.id, NULL),
                'catalog_available', EXISTS (
                    SELECT 1 FROM public.catalog_products product
                    WHERE product.product_type = 'pathway'
                      AND product.pathway_id = pathway.id
                      AND product.status = 'active'
                      AND EXISTS (SELECT 1 FROM public.catalog_plans plan_row WHERE plan_row.product_id = product.id AND plan_row.status = 'active')
                )
            ) ORDER BY COALESCE(pathway.display_order, 0), pathway.id
        ), '[]'::JSONB
    ) INTO v_pathways
    FROM public.pathways pathway;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', bank.id,
                'access', public.resolve_my_access('bank', NULL, bank.id),
                'catalog_available', EXISTS (
                    SELECT 1 FROM public.catalog_products product
                    WHERE product.product_type = 'bank'
                      AND product.question_bank_id = bank.id
                      AND product.status = 'active'
                      AND EXISTS (SELECT 1 FROM public.catalog_plans plan_row WHERE plan_row.product_id = product.id AND plan_row.status = 'active')
                ),
                'unlocked', public.can_access_question_bank(bank.id),
                'question_count', (SELECT count(*) FROM public.question_bank_questions q WHERE q.question_bank_id = bank.id),
                'article_count', (SELECT count(*) FROM public.question_bank_library_articles a WHERE a.question_bank_id = bank.id)
            ) ORDER BY COALESCE(bank.display_order, 0), bank.id
        ), '[]'::JSONB
    ) INTO v_banks
    FROM public.question_banks bank;

    RETURN jsonb_build_object(
        'global', v_global,
        'pathways', v_pathways,
        'banks', v_banks,
        'active_access', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', grant_row.id,
                    'scope_type', grant_row.scope_type,
                    'pathway_id', grant_row.pathway_id,
                    'question_bank_id', grant_row.question_bank_id,
                    'starts_at', grant_row.starts_at,
                    'expires_at', grant_row.expires_at,
                    'created_at', grant_row.created_at
                ) ORDER BY grant_row.created_at DESC
            )
            FROM public.user_access_grants grant_row
            WHERE grant_row.user_id = v_user_id
              AND grant_row.revoked_at IS NULL
              AND grant_row.starts_at <= now()
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
        ), '[]'::JSONB)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_catalog()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_products JSONB;
    v_audit JSONB;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', product.id,
                'product_type', product.product_type,
                'pathway_id', product.pathway_id,
                'question_bank_id', product.question_bank_id,
                'name', product.name,
                'status', product.status,
                'display_order', product.display_order,
                'show_prices', product.show_prices,
                'scope_description', product.scope_description,
                'created_at', product.created_at,
                'updated_at', product.updated_at,
                'trial', CASE WHEN product.product_type = 'bank' THEN (
                    SELECT jsonb_build_object(
                        'is_free_trial', bank.is_free_trial,
                        'free_trial_block_limit', COALESCE(bank.free_trial_block_limit, 0),
                        'free_trial_question_limit', bank.free_trial_question_limit,
                        'free_trial_article_limit', bank.free_trial_article_limit
                    )
                    FROM public.question_banks bank
                    WHERE bank.id = product.question_bank_id
                ) ELSE NULL END,
                'plans', COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', plan_row.id,
                            'product_id', plan_row.product_id,
                            'name', plan_row.name,
                            'duration_months', plan_row.duration_months,
                            'price', plan_row.price,
                            'currency', plan_row.currency,
                            'status', plan_row.status,
                            'show_price', plan_row.show_price,
                            'is_default', plan_row.is_default,
                            'is_recommended', plan_row.is_recommended,
                            'display_order', plan_row.display_order,
                            'version', plan_row.version,
                            'created_at', plan_row.created_at,
                            'updated_at', plan_row.updated_at
                        ) ORDER BY plan_row.display_order, plan_row.id
                    )
                    FROM public.catalog_plans plan_row
                    WHERE plan_row.product_id = product.id
                ), '[]'::JSONB)
            ) ORDER BY product.display_order, product.id
        ), '[]'::JSONB
    ) INTO v_products
    FROM public.catalog_products product;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', audit.id,
                'actor_user_id', audit.actor_user_id,
                'entity_type', CASE audit.entity_type
                    WHEN 'catalog_product' THEN 'product'
                    WHEN 'catalog_plan' THEN 'plan'
                    ELSE 'bank_trial'
                END,
                'entity_id', CASE WHEN audit.entity_id ~ '^[0-9]+$' THEN audit.entity_id::BIGINT ELSE 0 END,
                'action', audit.action,
                'before_data', audit.metadata->'before_data',
                'after_data', audit.metadata->'after_data',
                'created_at', audit.created_at
            ) ORDER BY audit.created_at DESC
        ), '[]'::JSONB
    ) INTO v_audit
    FROM (
        SELECT *
        FROM public.admin_audit_logs
        WHERE action LIKE 'catalog_%'
          AND entity_type IN ('catalog_product', 'catalog_plan', 'question_bank')
        ORDER BY created_at DESC
        LIMIT 100
    ) audit;

    RETURN jsonb_build_object('products', v_products, 'audit', v_audit);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_catalog_product(
    p_product_id BIGINT,
    p_status TEXT,
    p_display_order INTEGER,
    p_show_prices BOOLEAN,
    p_scope_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_product public.catalog_products%ROWTYPE;
    v_before JSONB;
    v_status TEXT := lower(btrim(COALESCE(p_status, '')));
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;
    IF v_status NOT IN ('draft', 'active', 'hidden', 'archived')
       OR p_display_order IS NULL OR p_display_order < 0 THEN
        RAISE EXCEPTION 'INVALID_CATALOG_PRODUCT';
    END IF;

    SELECT * INTO v_product
    FROM public.catalog_products
    WHERE id = p_product_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_NOT_FOUND';
    END IF;
    IF v_product.status = 'archived' THEN
        RAISE EXCEPTION 'ARCHIVED_PRODUCT_IS_IMMUTABLE';
    END IF;
    IF v_status = 'active' AND NOT EXISTS (
        SELECT 1 FROM public.catalog_plans plan_row
        WHERE plan_row.product_id = v_product.id AND plan_row.status = 'active'
    ) THEN
        RAISE EXCEPTION 'ACTIVE_PRODUCT_REQUIRES_ACTIVE_PLAN';
    END IF;
    IF p_show_prices AND EXISTS (
        SELECT 1 FROM public.catalog_plans plan_row
        WHERE plan_row.product_id = v_product.id
          AND plan_row.status = 'active'
          AND plan_row.show_price
          AND plan_row.price IS NULL
    ) THEN
        RAISE EXCEPTION 'VISIBLE_PRICE_REQUIRES_VALUE';
    END IF;

    v_before := to_jsonb(v_product);

    UPDATE public.catalog_products
    SET
        status = v_status,
        display_order = p_display_order,
        show_prices = COALESCE(p_show_prices, FALSE),
        scope_description = COALESCE(NULLIF(btrim(COALESCE(p_scope_description, '')), ''), scope_description),
        updated_by = auth.uid()
    WHERE id = v_product.id
    RETURNING * INTO v_product;

    PERFORM private.business_audit(
        'catalog_product_saved',
        'catalog_product',
        v_product.id::TEXT,
        jsonb_build_object('before_data', v_before, 'after_data', to_jsonb(v_product))
    );

    RETURN jsonb_build_object('id', v_product.id, 'status', v_product.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_catalog_plan(
    p_plan_id BIGINT,
    p_product_id BIGINT,
    p_name TEXT,
    p_duration_months INTEGER,
    p_price NUMERIC,
    p_currency TEXT,
    p_status TEXT,
    p_show_price BOOLEAN,
    p_is_default BOOLEAN,
    p_is_recommended BOOLEAN,
    p_display_order INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_product public.catalog_products%ROWTYPE;
    v_plan public.catalog_plans%ROWTYPE;
    v_before JSONB := NULL;
    v_name TEXT := btrim(COALESCE(p_name, ''));
    v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
    v_status TEXT := lower(btrim(COALESCE(p_status, '')));
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_name = ''
       OR (p_duration_months IS NOT NULL AND p_duration_months NOT BETWEEN 1 AND 120)
       OR (p_price IS NOT NULL AND p_price <= 0)
       OR v_currency !~ '^[A-Z]{3}$'
       OR v_status NOT IN ('active', 'inactive', 'archived')
       OR p_display_order IS NULL OR p_display_order < 0
       OR (COALESCE(p_show_price, FALSE) AND p_price IS NULL) THEN
        RAISE EXCEPTION 'INVALID_CATALOG_PLAN';
    END IF;

    SELECT * INTO v_product
    FROM public.catalog_products
    WHERE id = p_product_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_NOT_FOUND';
    END IF;
    IF v_product.status = 'archived' THEN
        RAISE EXCEPTION 'ARCHIVED_PRODUCT_IS_IMMUTABLE';
    END IF;

    IF p_plan_id IS NOT NULL THEN
        SELECT * INTO v_plan
        FROM public.catalog_plans
        WHERE id = p_plan_id AND product_id = p_product_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'CATALOG_PLAN_NOT_FOUND';
        END IF;
        IF v_plan.status = 'archived' THEN
            RAISE EXCEPTION 'ARCHIVED_PLAN_IS_IMMUTABLE';
        END IF;
        v_before := to_jsonb(v_plan);
    END IF;

    IF COALESCE(p_is_default, FALSE) THEN
        UPDATE public.catalog_plans
        SET is_default = FALSE, updated_by = auth.uid()
        WHERE product_id = p_product_id
          AND status <> 'archived'
          AND (p_plan_id IS NULL OR id <> p_plan_id);
    END IF;
    IF COALESCE(p_is_recommended, FALSE) THEN
        UPDATE public.catalog_plans
        SET is_recommended = FALSE, updated_by = auth.uid()
        WHERE product_id = p_product_id
          AND status <> 'archived'
          AND (p_plan_id IS NULL OR id <> p_plan_id);
    END IF;

    IF p_plan_id IS NULL THEN
        INSERT INTO public.catalog_plans (
            product_id, name, duration_months, price, currency, status, show_price,
            is_default, is_recommended, display_order, created_by, updated_by
        ) VALUES (
            p_product_id, v_name, p_duration_months, p_price, v_currency, v_status,
            COALESCE(p_show_price, FALSE), COALESCE(p_is_default, FALSE),
            COALESCE(p_is_recommended, FALSE), p_display_order, auth.uid(), auth.uid()
        )
        RETURNING * INTO v_plan;
    ELSE
        UPDATE public.catalog_plans
        SET
            name = v_name,
            duration_months = p_duration_months,
            price = p_price,
            currency = v_currency,
            status = v_status,
            show_price = COALESCE(p_show_price, FALSE),
            is_default = COALESCE(p_is_default, FALSE),
            is_recommended = COALESCE(p_is_recommended, FALSE),
            display_order = p_display_order,
            version = version + 1,
            updated_by = auth.uid()
        WHERE id = p_plan_id
        RETURNING * INTO v_plan;
    END IF;

    PERFORM private.business_audit(
        'catalog_plan_saved',
        'catalog_plan',
        v_plan.id::TEXT,
        jsonb_build_object('before_data', v_before, 'after_data', to_jsonb(v_plan))
    );

    RETURN jsonb_build_object(
        'id', v_plan.id,
        'product_id', v_plan.product_id,
        'status', v_plan.status,
        'version', v_plan.version
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_catalog_bank_trial(
    p_bank_id BIGINT,
    p_is_free_trial BOOLEAN,
    p_block_limit INTEGER,
    p_question_limit INTEGER,
    p_article_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_bank public.question_banks%ROWTYPE;
    v_before JSONB;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;
    IF p_block_limit IS NULL OR p_block_limit < 0
       OR p_question_limit IS NULL OR p_question_limit < 0
       OR p_article_limit IS NULL OR p_article_limit < 0 THEN
        RAISE EXCEPTION 'INVALID_TRIAL_CONFIGURATION';
    END IF;

    SELECT * INTO v_bank
    FROM public.question_banks
    WHERE id = p_bank_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_NOT_FOUND';
    END IF;

    v_before := jsonb_build_object(
        'is_free_trial', v_bank.is_free_trial,
        'free_trial_block_limit', v_bank.free_trial_block_limit,
        'free_trial_question_limit', v_bank.free_trial_question_limit,
        'free_trial_article_limit', v_bank.free_trial_article_limit
    );

    UPDATE public.question_banks
    SET
        is_free_trial = COALESCE(p_is_free_trial, FALSE),
        free_trial_block_limit = p_block_limit,
        free_trial_question_limit = p_question_limit,
        free_trial_article_limit = p_article_limit
    WHERE id = p_bank_id
    RETURNING * INTO v_bank;

    UPDATE public.pathways pathway
    SET is_free_trial_available = EXISTS (
        SELECT 1 FROM public.question_banks bank
        WHERE bank.pathway_id = pathway.id AND bank.is_free_trial
    )
    WHERE pathway.id = v_bank.pathway_id;

    PERFORM private.business_audit(
        'catalog_bank_trial_saved',
        'question_bank',
        v_bank.id::TEXT,
        jsonb_build_object(
            'before_data', v_before,
            'after_data', jsonb_build_object(
                'is_free_trial', v_bank.is_free_trial,
                'free_trial_block_limit', v_bank.free_trial_block_limit,
                'free_trial_question_limit', v_bank.free_trial_question_limit,
                'free_trial_article_limit', v_bank.free_trial_article_limit
            )
        )
    );

    RETURN jsonb_build_object('bank_id', v_bank.id);
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_my_access(TEXT, BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_catalog_quote(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_catalog_upgrade_offer(TEXT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_catalog_upgrade_request(BIGINT, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_my_catalog_upgrade_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_catalog_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_catalog() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_catalog_product(BIGINT, TEXT, INTEGER, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_save_catalog_plan(BIGINT, BIGINT, TEXT, INTEGER, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_catalog_bank_trial(BIGINT, BOOLEAN, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resolve_my_access(TEXT, BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_catalog_quote(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_upgrade_offer(TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_catalog_upgrade_request(BIGINT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_catalog_upgrade_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_catalog_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_catalog() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_catalog_product(BIGINT, TEXT, INTEGER, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_catalog_plan(BIGINT, BIGINT, TEXT, INTEGER, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_catalog_bank_trial(BIGINT, BOOLEAN, INTEGER, INTEGER, INTEGER) TO authenticated;

COMMIT;
