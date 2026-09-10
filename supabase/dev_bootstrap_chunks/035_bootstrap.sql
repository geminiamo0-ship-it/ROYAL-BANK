SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

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
