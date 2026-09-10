CREATE OR REPLACE FUNCTION public.support_get_upgrade_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_promo public.promo_codes%ROWTYPE;
    v_paid NUMERIC(12,2) := 0;
    v_payments JSONB := '[]'::jsonb;
    v_access JSONB := '[]'::jsonb;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    SELECT *
    INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    SELECT *
    INTO v_profile
    FROM public.profiles
    WHERE id = v_request.user_id;

    SELECT *
    INTO v_order
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
                )
                ORDER BY payment.paid_at DESC
            ),
            '[]'::jsonb
        )
        INTO v_payments
        FROM public.payments payment
        WHERE payment.order_id = v_order.id;
    END IF;

    IF v_request.promo_code_id IS NOT NULL THEN
        SELECT *
        INTO v_promo
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
            )
            ORDER BY grant_row.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_access
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
            'product_name', private.business_product_name(
                v_request.scope_type,
                v_request.pathway_id,
                v_request.question_bank_id
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

CREATE OR REPLACE FUNCTION public.admin_refund_upgrade_order(
    p_order_id UUID,
    p_reason TEXT,
    p_revoke_access BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_order public.orders%ROWTYPE;
    v_request public.upgrade_requests%ROWTYPE;
    v_commission public.commissions%ROWTYPE;
    v_refunded_amount NUMERIC(12,2);
    v_now TIMESTAMPTZ := timezone('utc'::text, clock_timestamp());
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'REFUND_REASON_REQUIRED';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND';
    END IF;

    IF v_order.status = 'refunded' THEN
        RETURN jsonb_build_object(
            'order_id', v_order.id,
            'status', v_order.status,
            'already_refunded', TRUE
        );
    END IF;

    IF v_order.status NOT IN ('paid', 'activated') THEN
        RAISE EXCEPTION 'ORDER_NOT_REFUNDABLE';
    END IF;

    SELECT *
    INTO v_request
    FROM public.upgrade_requests
    WHERE id = v_order.upgrade_request_id
    FOR UPDATE;

    SELECT *
    INTO v_commission
    FROM public.commissions
    WHERE order_id = v_order.id
    FOR UPDATE;

    IF FOUND AND v_commission.status = 'paid' THEN
        RAISE EXCEPTION 'SETTLED_COMMISSION_REFUND_REQUIRES_RECONCILIATION';
    END IF;

    SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2)
    INTO v_refunded_amount
    FROM public.payments
    WHERE order_id = v_order.id
      AND status = 'confirmed';

    IF v_refunded_amount <= 0 THEN
        RAISE EXCEPTION 'CONFIRMED_PAYMENT_REQUIRED';
    END IF;

    UPDATE public.payments
    SET
        status = 'refunded',
        refunded_at = v_now,
        refunded_by = auth.uid(),
        refund_reason = v_reason
    WHERE order_id = v_order.id
      AND status = 'confirmed';

    IF v_commission.id IS NOT NULL AND v_commission.status IN ('pending', 'approved') THEN
        UPDATE public.commissions
        SET
            status = 'reversed',
            reversed_at = v_now
        WHERE id = v_commission.id;
    END IF;

    UPDATE public.orders
    SET
        status = 'refunded',
        refunded_at = v_now,
        refunded_by = auth.uid(),
        refund_reason = v_reason
    WHERE id = v_order.id
    RETURNING * INTO v_order;

    IF COALESCE(p_revoke_access, TRUE)
       AND v_request.access_grant_id IS NOT NULL THEN
        UPDATE public.user_access_grants
        SET
            revoked_at = COALESCE(revoked_at, v_now),
            revoked_by = COALESCE(revoked_by, auth.uid()),
            revoke_reason = COALESCE(revoke_reason, 'refund: ' || v_reason)
        WHERE id = v_request.access_grant_id;
    END IF;

    PERFORM private.business_audit(
        'upgrade_order_refunded',
        'order',
        v_order.id::TEXT,
        jsonb_build_object(
            'request_id', v_order.upgrade_request_id,
            'amount', v_refunded_amount,
            'currency', v_order.currency,
            'revoke_access', COALESCE(p_revoke_access, TRUE),
            'access_grant_id', v_request.access_grant_id,
            'reason', v_reason
        )
    );

    RETURN jsonb_build_object(
        'order_id', v_order.id,
        'status', v_order.status,
        'refunded_amount', v_refunded_amount,
        'currency', v_order.currency,
        'access_revoked', COALESCE(p_revoke_access, TRUE) AND v_request.access_grant_id IS NOT NULL,
        'already_refunded', FALSE
    );
END;
$$;

-- Safe self-service view of active premium grants for subscription UI.
-- The function exposes only the signed-in user's entitlement scope and dates.

CREATE OR REPLACE FUNCTION public.get_my_active_access_grants()
RETURNS TABLE (
    id BIGINT,
    scope_type TEXT,
    pathway_id BIGINT,
    question_bank_id BIGINT,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    RETURN QUERY
    SELECT
        grant_row.id,
        grant_row.scope_type,
        grant_row.pathway_id,
        grant_row.question_bank_id,
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.created_at
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = auth.uid()
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ORDER BY grant_row.created_at DESC, grant_row.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_access_grants() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_my_active_access_grants() TO authenticated;

COMMENT ON FUNCTION public.get_my_active_access_grants() IS
    'Returns only the signed-in active user current premium grant scopes and dates for subscription-status UI.';
