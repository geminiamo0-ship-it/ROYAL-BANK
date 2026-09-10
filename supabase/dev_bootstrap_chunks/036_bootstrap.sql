SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

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
