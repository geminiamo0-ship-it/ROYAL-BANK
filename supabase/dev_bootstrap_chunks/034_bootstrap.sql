SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

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
