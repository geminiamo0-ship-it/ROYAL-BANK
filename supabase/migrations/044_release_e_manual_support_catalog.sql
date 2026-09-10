BEGIN;

-- Catalog requests feed the existing manual Support workflow.
-- No payment provider, automatic payment verification, or automatic access activation is introduced.

CREATE OR REPLACE FUNCTION public.support_list_upgrade_requests(
    p_status TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    request_id UUID,
    public_code TEXT,
    request_status TEXT,
    created_at TIMESTAMPTZ,
    full_name TEXT,
    email TEXT,
    scope_type TEXT,
    product_name TEXT,
    promo_code TEXT,
    order_id UUID,
    order_status TEXT,
    agreed_price NUMERIC,
    currency TEXT,
    paid_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_status TEXT := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
    v_search TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    IF v_status IS NOT NULL
       AND v_status NOT IN ('pending', 'contacted', 'paid', 'activated', 'cancelled') THEN
        RAISE EXCEPTION 'INVALID_REQUEST_STATUS';
    END IF;

    RETURN QUERY
    SELECT
        request_row.id,
        request_row.public_code,
        request_row.status,
        request_row.created_at,
        profile.full_name,
        profile.email,
        request_row.scope_type,
        COALESCE(
            request_row.quote_snapshot->>'product_name',
            private.business_product_name(
                request_row.scope_type,
                request_row.pathway_id,
                request_row.question_bank_id
            )
        ),
        request_row.promo_code_entered,
        order_row.id,
        order_row.status,
        order_row.agreed_price,
        order_row.currency,
        COALESCE(payment_totals.paid_amount, 0::NUMERIC)
    FROM public.upgrade_requests request_row
    JOIN public.profiles profile
      ON profile.id = request_row.user_id
    LEFT JOIN public.orders order_row
      ON order_row.upgrade_request_id = request_row.id
    LEFT JOIN LATERAL (
        SELECT COALESCE(sum(payment.amount), 0::NUMERIC) AS paid_amount
        FROM public.payments payment
        WHERE payment.order_id = order_row.id
          AND payment.status = 'confirmed'
    ) payment_totals ON TRUE
    WHERE (v_status IS NULL OR request_row.status = v_status)
      AND (
          v_search IS NULL
          OR request_row.public_code ILIKE '%' || v_search || '%'
          OR profile.email ILIKE '%' || v_search || '%'
          OR COALESCE(profile.full_name, '') ILIKE '%' || v_search || '%'
      )
    ORDER BY
        CASE request_row.status
            WHEN 'pending' THEN 1
            WHEN 'contacted' THEN 2
            WHEN 'paid' THEN 3
            WHEN 'activated' THEN 4
            ELSE 5
        END,
        request_row.created_at DESC
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_get_upgrade_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_promo public.promo_codes%ROWTYPE;
    v_paid NUMERIC(12,2) := 0;
    v_payments JSONB := '[]'::JSONB;
    v_access JSONB := '[]'::JSONB;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    SELECT * INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_request.user_id;

    SELECT * INTO v_order
    FROM public.orders
    WHERE upgrade_request_id = v_request.id;

    IF FOUND THEN
        SELECT COALESCE(sum(amount), 0)
        INTO v_paid
        FROM public.payments
        WHERE order_id = v_order.id
          AND status = 'confirmed';

        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', payment.id,
                    'amount', payment.amount,
                    'currency', payment.currency,
                    'payment_method', payment.payment_method,
                    'transaction_reference', payment.transaction_reference,
                    'notes', payment.notes,
                    'status', payment.status,
                    'paid_at', payment.paid_at
                ) ORDER BY payment.paid_at DESC
            ), '[]'::JSONB
        ) INTO v_payments
        FROM public.payments payment
        WHERE payment.order_id = v_order.id;
    END IF;

    IF v_request.promo_code_id IS NOT NULL THEN
        SELECT * INTO v_promo
        FROM public.promo_codes
        WHERE id = v_request.promo_code_id;
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', grant_row.id,
                'scope_type', grant_row.scope_type,
                'pathway_id', grant_row.pathway_id,
                'question_bank_id', grant_row.question_bank_id,
                'starts_at', grant_row.starts_at,
                'expires_at', grant_row.expires_at
            ) ORDER BY grant_row.created_at DESC
        ), '[]'::JSONB
    ) INTO v_access
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = v_request.user_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now());

    RETURN jsonb_build_object(
        'request', jsonb_build_object(
            'id', v_request.id,
            'public_code', v_request.public_code,
            'status', v_request.status,
            'scope_type', v_request.scope_type,
            'pathway_id', v_request.pathway_id,
            'question_bank_id', v_request.question_bank_id,
            'catalog_product_id', v_request.catalog_product_id,
            'catalog_plan_id', v_request.catalog_plan_id,
            'product_name', COALESCE(
                v_request.quote_snapshot->>'product_name',
                private.business_product_name(v_request.scope_type, v_request.pathway_id, v_request.question_bank_id)
            ),
            'promo_code', v_request.promo_code_entered,
            'created_at', v_request.created_at,
            'contacted_at', v_request.contacted_at,
            'activated_at', v_request.activated_at,
            'access_grant_id', v_request.access_grant_id
        ),
        'user', jsonb_build_object(
            'id', v_profile.id,
            'full_name', v_profile.full_name,
            'email', v_profile.email,
            'is_active', v_profile.is_active,
            'subscription_tier', v_profile.subscription_tier
        ),
        'promo', CASE
            WHEN v_request.promo_code_id IS NULL OR v_promo.id IS NULL THEN NULL
            ELSE jsonb_build_object(
                'code', v_promo.code,
                'discount_type', v_promo.discount_type,
                'discount_value', v_promo.discount_value,
                'discount_currency', v_promo.discount_currency
            )
        END,
        'quote', CASE
            WHEN v_request.quote_snapshot IS NULL THEN NULL
            ELSE jsonb_build_object(
                'catalog_product_id', v_request.catalog_product_id,
                'catalog_plan_id', v_request.catalog_plan_id,
                'mode', v_request.quote_snapshot->>'mode',
                'plan_name', v_request.quote_snapshot->>'plan_name',
                'duration_months', NULLIF(v_request.quote_snapshot->>'duration_months', '')::INTEGER,
                'currency', v_request.quote_snapshot->>'currency',
                'price_visible_to_customer', COALESCE((v_request.quote_snapshot->>'price_visible')::BOOLEAN, FALSE),
                'price_locked', NULLIF(v_request.quote_snapshot->>'base_price', '') IS NOT NULL,
                'base_price', NULLIF(v_request.quote_snapshot->>'base_price', '')::NUMERIC,
                'discount_amount', NULLIF(v_request.quote_snapshot->>'discount_amount', '')::NUMERIC,
                'final_price', NULLIF(v_request.quote_snapshot->>'final_price', '')::NUMERIC,
                'plan_version', NULLIF(v_request.quote_snapshot->>'plan_version', '')::INTEGER
            )
        END,
        'order', CASE
            WHEN v_order.id IS NULL THEN NULL
            ELSE jsonb_build_object(
                'id', v_order.id,
                'duration_months', v_order.duration_months,
                'base_price', v_order.base_price,
                'discount_amount', v_order.discount_amount,
                'agreed_price', v_order.agreed_price,
                'currency', v_order.currency,
                'internal_notes', v_order.internal_notes,
                'status', v_order.status,
                'paid_amount', v_paid,
                'amount_due', GREATEST(v_order.agreed_price - v_paid, 0)
            )
        END,
        'payments', v_payments,
        'active_access', v_access
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.support_save_upgrade_order(
    p_request_id UUID,
    p_duration_months INTEGER,
    p_base_price NUMERIC,
    p_discount_amount NUMERIC,
    p_agreed_price NUMERIC,
    p_currency TEXT,
    p_internal_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_promo public.promo_codes%ROWTYPE;
    v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
    v_snapshot JSONB := NULL;
    v_had_order BOOLEAN := FALSE;
    v_quote JSONB;
    v_quote_duration INTEGER;
    v_quote_currency TEXT;
    v_quote_base NUMERIC;
    v_quote_discount NUMERIC;
    v_quote_final NUMERIC;
    v_price_locked BOOLEAN := FALSE;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    IF p_duration_months IS NOT NULL
       AND (p_duration_months < 1 OR p_duration_months > 120) THEN
        RAISE EXCEPTION 'INVALID_ACCESS_DURATION';
    END IF;

    IF p_base_price IS NULL OR p_base_price < 0
       OR p_discount_amount IS NULL OR p_discount_amount < 0
       OR p_agreed_price IS NULL OR p_agreed_price <= 0
       OR v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'INVALID_ORDER_VALUES';
    END IF;

    SELECT * INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    IF v_request.status IN ('paid', 'activated', 'cancelled') THEN
        RAISE EXCEPTION 'ORDER_LOCKED';
    END IF;

    v_quote := v_request.quote_snapshot;
    IF v_quote IS NOT NULL THEN
        v_quote_duration := NULLIF(v_quote->>'duration_months', '')::INTEGER;
        v_quote_currency := v_quote->>'currency';
        v_quote_base := NULLIF(v_quote->>'base_price', '')::NUMERIC;
        v_quote_discount := NULLIF(v_quote->>'discount_amount', '')::NUMERIC;
        v_quote_final := NULLIF(v_quote->>'final_price', '')::NUMERIC;
        v_price_locked := v_quote_base IS NOT NULL;

        IF p_duration_months IS DISTINCT FROM v_quote_duration
           OR v_currency IS DISTINCT FROM v_quote_currency THEN
            RAISE EXCEPTION 'CATALOG_ORDER_MUST_MATCH_QUOTE';
        END IF;

        IF v_price_locked AND (
            p_base_price IS DISTINCT FROM v_quote_base
            OR p_discount_amount IS DISTINCT FROM COALESCE(v_quote_discount, 0)
            OR p_agreed_price IS DISTINCT FROM v_quote_final
        ) THEN
            RAISE EXCEPTION 'CATALOG_ORDER_MUST_MATCH_QUOTE';
        END IF;
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE upgrade_request_id = v_request.id
    FOR UPDATE;
    v_had_order := FOUND;

    IF v_had_order AND EXISTS (
        SELECT 1 FROM public.payments
        WHERE order_id = v_order.id
          AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'ORDER_LOCKED';
    END IF;

    IF v_request.promo_code_id IS NOT NULL THEN
        SELECT * INTO v_promo
        FROM public.promo_codes
        WHERE id = v_request.promo_code_id;

        IF FOUND THEN
            v_snapshot := jsonb_build_object(
                'promo_code_id', v_promo.id,
                'code', v_promo.code,
                'owner_user_id', v_promo.owner_user_id,
                'discount_type', v_promo.discount_type,
                'discount_value', v_promo.discount_value,
                'discount_currency', v_promo.discount_currency,
                'commission_type', v_promo.commission_type,
                'commission_value', v_promo.commission_value,
                'commission_currency', v_promo.commission_currency,
                'commission_basis', v_promo.commission_basis
            );
        END IF;
    END IF;

    IF v_had_order THEN
        UPDATE public.orders
        SET
            duration_months = p_duration_months,
            base_price = p_base_price,
            discount_amount = p_discount_amount,
            agreed_price = p_agreed_price,
            currency = v_currency,
            promo_code_id = v_request.promo_code_id,
            promo_rule_snapshot = v_snapshot,
            internal_notes = NULLIF(btrim(COALESCE(p_internal_notes, '')), '')
        WHERE id = v_order.id
        RETURNING * INTO v_order;
    ELSE
        INSERT INTO public.orders (
            upgrade_request_id, user_id, scope_type, pathway_id, question_bank_id,
            duration_months, base_price, discount_amount, agreed_price, currency,
            promo_code_id, promo_rule_snapshot, internal_notes, created_by
        ) VALUES (
            v_request.id, v_request.user_id, v_request.scope_type, v_request.pathway_id,
            v_request.question_bank_id, p_duration_months, p_base_price, p_discount_amount,
            p_agreed_price, v_currency, v_request.promo_code_id, v_snapshot,
            NULLIF(btrim(COALESCE(p_internal_notes, '')), ''), auth.uid()
        )
        RETURNING * INTO v_order;
    END IF;

    IF v_request.status = 'pending' THEN
        UPDATE public.upgrade_requests
        SET
            status = 'contacted',
            contacted_at = COALESCE(contacted_at, timezone('utc'::text, now())),
            contacted_by = COALESCE(contacted_by, auth.uid())
        WHERE id = v_request.id;
    END IF;

    PERFORM private.business_audit(
        CASE WHEN v_had_order THEN 'upgrade_order_updated' ELSE 'upgrade_order_created' END,
        'order',
        v_order.id::TEXT,
        jsonb_build_object(
            'request_id', v_request.id,
            'public_code', v_request.public_code,
            'currency', v_order.currency,
            'agreed_price', v_order.agreed_price,
            'duration_months', v_order.duration_months,
            'catalog_quote_locked', v_price_locked,
            'catalog_plan_id', v_request.catalog_plan_id
        )
    );

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'status', v_order.status,
        'agreed_price', v_order.agreed_price,
        'currency', v_order.currency
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.support_activate_upgrade(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_grant public.user_access_grants%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_paid NUMERIC(12,2);
    v_start TIMESTAMPTZ := timezone('utc'::text, now());
    v_expires TIMESTAMPTZ;
    v_old_expires TIMESTAMPTZ;
    v_snapshot JSONB;
    v_partner_user_id UUID;
    v_commission_type TEXT;
    v_commission_value NUMERIC(12,4);
    v_commission_basis TEXT;
    v_commission_currency TEXT;
    v_basis_amount NUMERIC(12,2);
    v_commission_amount NUMERIC(12,2);
    v_promo public.promo_codes%ROWTYPE;
    v_is_extension BOOLEAN := FALSE;
    v_extension_grant_id BIGINT;
    v_bank_pathway_id BIGINT;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    SELECT * INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    IF v_request.status = 'activated' AND v_request.access_grant_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'request_id', v_request.id,
            'public_code', v_request.public_code,
            'status', v_request.status,
            'access_grant_id', v_request.access_grant_id,
            'already_activated', TRUE,
            'extension', COALESCE(v_request.quote_snapshot->>'mode', '') = 'extension'
        );
    END IF;

    IF v_request.status = 'cancelled' THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_CANCELLED';
    END IF;

    SELECT * INTO v_order
    FROM public.orders
    WHERE upgrade_request_id = v_request.id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_REQUIRED';
    END IF;

    SELECT COALESCE(sum(amount), 0)
    INTO v_paid
    FROM public.payments
    WHERE order_id = v_order.id
      AND status = 'confirmed';

    IF v_paid < v_order.agreed_price OR v_order.status <> 'paid' THEN
        RAISE EXCEPTION 'PAYMENT_REQUIRED';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_request.user_id
    FOR UPDATE;
    IF NOT FOUND OR NOT v_profile.is_active THEN
        RAISE EXCEPTION 'USER_INACTIVE';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('royal:activation:' || v_request.user_id::TEXT, 0));

    v_is_extension := COALESCE(v_request.quote_snapshot->>'mode', '') = 'extension';

    IF v_is_extension THEN
        v_extension_grant_id := NULLIF(v_request.quote_snapshot->>'extension_grant_id', '')::BIGINT;
        IF v_extension_grant_id IS NULL THEN
            RAISE EXCEPTION 'EXTENSION_TARGET_NOT_ACTIVE';
        END IF;

        -- Recheck that no broader active grant now makes this narrower extension redundant.
        IF v_request.scope_type = 'pathway' AND EXISTS (
            SELECT 1 FROM public.user_access_grants grant_row
            WHERE grant_row.user_id = v_request.user_id
              AND grant_row.scope_type = 'global'
              AND grant_row.revoked_at IS NULL
              AND grant_row.starts_at <= now()
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
        ) THEN
            RAISE EXCEPTION 'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT';
        ELSIF v_request.scope_type = 'bank' THEN
            SELECT pathway_id INTO v_bank_pathway_id
            FROM public.question_banks
            WHERE id = v_request.question_bank_id;

            IF EXISTS (
                SELECT 1 FROM public.user_access_grants grant_row
                WHERE grant_row.user_id = v_request.user_id
                  AND grant_row.revoked_at IS NULL
                  AND grant_row.starts_at <= now()
                  AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
                  AND (
                      grant_row.scope_type = 'global'
                      OR (grant_row.scope_type = 'pathway' AND grant_row.pathway_id = v_bank_pathway_id)
                  )
            ) THEN
                RAISE EXCEPTION 'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT';
            END IF;
        END IF;

        SELECT * INTO v_grant
        FROM public.user_access_grants grant_row
        WHERE grant_row.id = v_extension_grant_id
          AND grant_row.user_id = v_request.user_id
          AND grant_row.revoked_at IS NULL
          AND grant_row.expires_at IS NOT NULL
          AND (
              (v_request.scope_type = 'global' AND grant_row.scope_type = 'global')
              OR (v_request.scope_type = 'pathway' AND grant_row.scope_type = 'pathway' AND grant_row.pathway_id = v_request.pathway_id)
              OR (v_request.scope_type = 'bank' AND grant_row.scope_type = 'bank' AND grant_row.question_bank_id = v_request.question_bank_id)
          )
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'EXTENSION_TARGET_NOT_ACTIVE';
        END IF;

        v_old_expires := v_grant.expires_at;
        v_expires := CASE
            WHEN v_order.duration_months IS NULL THEN NULL
            ELSE GREATEST(v_grant.expires_at, v_start) + make_interval(months => v_order.duration_months)
        END;

        UPDATE public.user_access_grants
        SET expires_at = v_expires
        WHERE id = v_grant.id
        RETURNING * INTO v_grant;

        PERFORM private.business_audit(
            'access_grant_extended_from_upgrade',
            'user_access_grant',
            v_grant.id::TEXT,
            jsonb_build_object(
                'request_id', v_request.id,
                'order_id', v_order.id,
                'old_expires_at', v_old_expires,
                'new_expires_at', v_grant.expires_at
            )
        );
    ELSE
        IF private.business_user_has_covering_grant(
            v_request.user_id,
            v_request.scope_type,
            v_request.pathway_id,
            v_request.question_bank_id
        ) THEN
            RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
        END IF;

        v_expires := CASE
            WHEN v_order.duration_months IS NULL THEN NULL
            ELSE v_start + make_interval(months => v_order.duration_months)
        END;

        SELECT * INTO v_grant
        FROM public.grant_user_access(
            v_request.user_id,
            v_request.scope_type,
            v_request.pathway_id,
            v_request.question_bank_id,
            v_start,
            v_expires
        );
    END IF;

    UPDATE public.orders
    SET status = 'activated'
    WHERE id = v_order.id;

    UPDATE public.upgrade_requests
    SET
        status = 'activated',
        activated_at = v_start,
        activated_by = auth.uid(),
        access_grant_id = v_grant.id
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    v_snapshot := v_order.promo_rule_snapshot;
    IF v_order.promo_code_id IS NOT NULL AND v_snapshot IS NOT NULL THEN
        v_partner_user_id := NULLIF(v_snapshot->>'owner_user_id', '')::UUID;
        v_commission_type := COALESCE(v_snapshot->>'commission_type', 'none');
        v_commission_value := NULLIF(v_snapshot->>'commission_value', '')::NUMERIC;
        v_commission_basis := COALESCE(v_snapshot->>'commission_basis', 'amount_paid');
        v_commission_currency := NULLIF(v_snapshot->>'commission_currency', '');

        IF v_partner_user_id IS NOT NULL
           AND v_commission_type IN ('percentage', 'fixed')
           AND v_commission_value IS NOT NULL
           AND v_commission_value > 0 THEN
            v_basis_amount := CASE
                WHEN v_commission_basis = 'agreed_price' THEN v_order.agreed_price
                ELSE LEAST(v_paid, v_order.agreed_price)
            END;

            IF v_commission_type = 'percentage' THEN
                v_commission_amount := round((v_basis_amount * v_commission_value / 100.0)::NUMERIC, 2);
            ELSE
                IF v_commission_currency IS DISTINCT FROM v_order.currency THEN
                    RAISE EXCEPTION 'COMMISSION_CURRENCY_MISMATCH';
                END IF;
                v_commission_amount := round(v_commission_value::NUMERIC, 2);
            END IF;

            IF v_commission_amount > 0 THEN
                INSERT INTO public.commissions (
                    order_id, promo_code_id, partner_user_id, basis_amount,
                    commission_type, commission_value, commission_amount,
                    currency, status, approved_at
                ) VALUES (
                    v_order.id, v_order.promo_code_id, v_partner_user_id, v_basis_amount,
                    v_commission_type, v_commission_value, v_commission_amount,
                    v_order.currency, 'approved', v_start
                )
                ON CONFLICT (order_id) DO NOTHING;
            END IF;
        END IF;
    END IF;

    PERFORM private.business_audit(
        CASE WHEN v_is_extension THEN 'upgrade_access_extended' ELSE 'upgrade_access_activated' END,
        'upgrade_request',
        v_request.id::TEXT,
        jsonb_build_object(
            'public_code', v_request.public_code,
            'order_id', v_order.id,
            'access_grant_id', v_grant.id,
            'scope_type', v_request.scope_type,
            'pathway_id', v_request.pathway_id,
            'question_bank_id', v_request.question_bank_id,
            'extension', v_is_extension
        )
    );

    RETURN jsonb_build_object(
        'request_id', v_request.id,
        'public_code', v_request.public_code,
        'status', v_request.status,
        'access_grant_id', v_grant.id,
        'already_activated', FALSE,
        'extension', v_is_extension
    );
END;
$$;

REVOKE ALL ON FUNCTION public.support_list_upgrade_requests(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_get_upgrade_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_save_upgrade_order(UUID, INTEGER, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_activate_upgrade(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_list_upgrade_requests(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_get_upgrade_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_save_upgrade_order(UUID, INTEGER, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_activate_upgrade(UUID) TO authenticated;

COMMIT;
