SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE OR REPLACE FUNCTION public.support_activate_upgrade(
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_grant public.user_access_grants%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_paid NUMERIC(12,2);
    v_start TIMESTAMPTZ := timezone('utc'::text, now());
    v_expires TIMESTAMPTZ;
    v_snapshot JSONB;
    v_partner_user_id UUID;
    v_commission_type TEXT;
    v_commission_value NUMERIC(12,4);
    v_commission_basis TEXT;
    v_commission_currency TEXT;
    v_basis_amount NUMERIC(12,2);
    v_commission_amount NUMERIC(12,2);
    v_promo public.promo_codes%ROWTYPE;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    SELECT *
    INTO v_request
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
            'already_activated', TRUE
        );
    END IF;

    IF v_request.status = 'cancelled' THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_CANCELLED';
    END IF;

    SELECT *
    INTO v_order
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

    SELECT *
    INTO v_profile
    FROM public.profiles
    WHERE id = v_request.user_id
    FOR UPDATE;

    IF NOT FOUND OR NOT v_profile.is_active THEN
        RAISE EXCEPTION 'USER_INACTIVE';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:activation:' || v_request.user_id::TEXT, 0)
    );

    IF private.business_user_has_covering_grant(
        v_request.user_id,
        v_request.scope_type,
        v_request.pathway_id,
        v_request.question_bank_id
    ) THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
    END IF;

    IF v_request.promo_code_id IS NOT NULL THEN
        SELECT *
        INTO v_promo
        FROM public.promo_codes
        WHERE id = v_request.promo_code_id
        FOR UPDATE;

        IF FOUND
           AND v_promo.max_activations IS NOT NULL
           AND (
               SELECT count(*)
               FROM public.upgrade_requests activated_request
               WHERE activated_request.promo_code_id = v_promo.id
                 AND activated_request.status = 'activated'
           ) >= v_promo.max_activations THEN
            RAISE EXCEPTION 'PROMO_CODE_LIMIT_REACHED';
        END IF;
    END IF;

    v_expires := CASE
        WHEN v_order.duration_months IS NULL THEN NULL
        ELSE v_start + make_interval(months => v_order.duration_months)
    END;

    SELECT *
    INTO v_grant
    FROM public.grant_user_access(
        v_request.user_id,
        v_request.scope_type,
        v_request.pathway_id,
        v_request.question_bank_id,
        v_start,
        v_expires
    );

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
                v_commission_amount := round(
                    (v_basis_amount * v_commission_value / 100.0)::NUMERIC,
                    2
                );
            ELSE
                IF v_commission_currency IS DISTINCT FROM v_order.currency THEN
                    RAISE EXCEPTION 'COMMISSION_CURRENCY_MISMATCH';
                END IF;
                v_commission_amount := round(v_commission_value::NUMERIC, 2);
            END IF;

            IF v_commission_amount > 0 THEN
                INSERT INTO public.commissions (
                    order_id,
                    promo_code_id,
                    partner_user_id,
                    basis_amount,
                    commission_type,
                    commission_value,
                    commission_amount,
                    currency,
                    status,
                    approved_at
                ) VALUES (
                    v_order.id,
                    v_order.promo_code_id,
                    v_partner_user_id,
                    v_basis_amount,
                    v_commission_type,
                    v_commission_value,
                    v_commission_amount,
                    v_order.currency,
                    'approved',
                    v_start
                )
                ON CONFLICT (order_id) DO NOTHING;
            END IF;
        END IF;
    END IF;

    PERFORM private.business_audit(
        'upgrade_access_activated',
        'upgrade_request',
        v_request.id::TEXT,
        jsonb_build_object(
            'public_code', v_request.public_code,
            'order_id', v_order.id,
            'access_grant_id', v_grant.id,
            'scope_type', v_request.scope_type,
            'pathway_id', v_request.pathway_id,
            'question_bank_id', v_request.question_bank_id
        )
    );

    RETURN jsonb_build_object(
        'request_id', v_request.id,
        'public_code', v_request.public_code,
        'status', v_request.status,
        'access_grant_id', v_grant.id,
        'already_activated', FALSE
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.support_cancel_upgrade(
    p_request_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_order_id UUID;
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'CANCEL_REASON_REQUIRED';
    END IF;

    SELECT *
    INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    IF v_request.status = 'activated' THEN
        RAISE EXCEPTION 'ACTIVATED_REQUEST_CANNOT_BE_CANCELLED';
    END IF;

    SELECT id
    INTO v_order_id
    FROM public.orders
    WHERE upgrade_request_id = v_request.id
    FOR UPDATE;

    IF v_order_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.payments
        WHERE order_id = v_order_id
          AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'PAID_REQUEST_CANNOT_BE_CANCELLED';
    END IF;

    IF v_request.status <> 'cancelled' THEN
        UPDATE public.upgrade_requests
        SET
            status = 'cancelled',
            cancelled_at = timezone('utc'::text, now()),
            cancelled_by = auth.uid(),
            cancel_reason = v_reason
        WHERE id = v_request.id
        RETURNING * INTO v_request;

        IF v_order_id IS NOT NULL THEN
            UPDATE public.orders
            SET status = 'cancelled'
            WHERE id = v_order_id;
        END IF;

        PERFORM private.business_audit(
            'upgrade_request_cancelled',
            'upgrade_request',
            v_request.id::TEXT,
            jsonb_build_object(
                'public_code', v_request.public_code,
                'reason', v_reason
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'request_id', v_request.id,
        'status', v_request.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_upgrade_request(TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_list_upgrade_requests(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_get_upgrade_request(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_mark_upgrade_contacted(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_save_upgrade_order(UUID, INTEGER, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_record_upgrade_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_activate_upgrade(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.support_cancel_upgrade(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_upgrade_request(TEXT, BIGINT, BIGINT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_list_upgrade_requests(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_get_upgrade_request(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_mark_upgrade_contacted(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_save_upgrade_order(UUID, INTEGER, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_record_upgrade_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_activate_upgrade(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.support_cancel_upgrade(UUID, TEXT) TO authenticated;

COMMENT ON TABLE public.upgrade_requests IS
    'User upgrade intent and support workflow state. This table does not grant premium access.';

COMMENT ON TABLE public.orders IS
    'Commercial agreement for an upgrade request. Orders do not grant premium access.';

COMMENT ON TABLE public.payments IS
    'Manual payment ledger recorded by support. Payments do not grant premium access.';

COMMENT ON TABLE public.commissions IS
    'Per-activated-order affiliate commission ledger. Not exposed to promo owners.';

COMMENT ON TABLE public.promo_codes IS
    'Promo attribution and pricing/commission rules. Promo ownership never grants business-data access.';

-- Royal promo / finance business core.
--
-- Keeps customer entitlement, commercial accounting, and promo-owner visibility
-- separated. Promo owners can only read their own coupon code + unique successful
-- activated-user count. Finance and commission operations are admin-only.

ALTER TABLE public.orders
    ADD COLUMN refunded_at TIMESTAMPTZ,
    ADD COLUMN refunded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN refund_reason TEXT;

ALTER TABLE public.orders
    ADD CONSTRAINT orders_refund_shape
    CHECK (
        status <> 'refunded'
        OR (refunded_at IS NOT NULL AND refund_reason IS NOT NULL)
    );

ALTER TABLE public.payments
    ADD COLUMN refunded_at TIMESTAMPTZ,
    ADD COLUMN refunded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN refund_reason TEXT;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_refund_shape
    CHECK (
        status <> 'refunded'
        OR (refunded_at IS NOT NULL AND refund_reason IS NOT NULL)
    );

CREATE TABLE public.commission_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    payment_method TEXT NOT NULL CHECK (char_length(btrim(payment_method)) BETWEEN 2 AND 80),
    transaction_reference TEXT,
    notes TEXT,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX commission_settlements_partner_idx
    ON public.commission_settlements (partner_user_id, paid_at DESC);

CREATE TABLE public.commission_settlement_items (
    settlement_id UUID NOT NULL REFERENCES public.commission_settlements(id) ON DELETE RESTRICT,
    commission_id UUID NOT NULL UNIQUE REFERENCES public.commissions(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    PRIMARY KEY (settlement_id, commission_id)
);

ALTER TABLE public.commission_settlements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.commission_settlement_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.commission_settlements FROM anon, authenticated;

REVOKE ALL ON TABLE public.commission_settlement_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.business_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
          AND is_active = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION public.partner_get_coupon_summary()
RETURNS TABLE (
    code TEXT,
    activated_users BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    RETURN QUERY
    SELECT
        promo.code,
        COUNT(DISTINCT request_row.user_id) FILTER (
            WHERE request_row.status = 'activated'
              AND order_row.status = 'activated'
        )::BIGINT AS activated_users
    FROM public.promo_codes promo
    LEFT JOIN public.upgrade_requests request_row
      ON request_row.promo_code_id = promo.id
    LEFT JOIN public.orders order_row
      ON order_row.upgrade_request_id = request_row.id
    WHERE promo.owner_user_id = auth.uid()
    GROUP BY promo.id, promo.code, promo.created_at
    ORDER BY promo.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_promo_codes()
RETURNS TABLE (
    id BIGINT,
    code TEXT,
    owner_user_id UUID,
    owner_name TEXT,
    owner_email TEXT,
    status TEXT,
    discount_type TEXT,
    discount_value NUMERIC,
    discount_currency TEXT,
    commission_type TEXT,
    commission_value NUMERIC,
    commission_currency TEXT,
    commission_basis TEXT,
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    max_activations INTEGER,
    activated_users BIGINT,
    successful_activations BIGINT,
    created_at TIMESTAMPTZ
)
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

    RETURN QUERY
    SELECT
        promo.id,
        promo.code,
        promo.owner_user_id,
        owner_profile.full_name,
        owner_profile.email,
        promo.status,
        promo.discount_type,
        promo.discount_value,
        promo.discount_currency,
        promo.commission_type,
        promo.commission_value,
        promo.commission_currency,
        promo.commission_basis,
        promo.valid_from,
        promo.valid_until,
        promo.max_activations,
        COALESCE(stats.activated_users, 0)::BIGINT,
        COALESCE(stats.successful_activations, 0)::BIGINT,
        promo.created_at
    FROM public.promo_codes promo
    LEFT JOIN public.profiles owner_profile
      ON owner_profile.id = promo.owner_user_id
    LEFT JOIN LATERAL (
        SELECT
            COUNT(DISTINCT request_row.user_id) FILTER (
                WHERE request_row.status = 'activated'
                  AND order_row.status = 'activated'
            ) AS activated_users,
            COUNT(*) FILTER (
                WHERE request_row.status = 'activated'
                  AND order_row.status = 'activated'
            ) AS successful_activations
        FROM public.upgrade_requests request_row
        LEFT JOIN public.orders order_row
          ON order_row.upgrade_request_id = request_row.id
        WHERE request_row.promo_code_id = promo.id
    ) stats ON TRUE
    ORDER BY promo.created_at DESC;
END;
$$;
