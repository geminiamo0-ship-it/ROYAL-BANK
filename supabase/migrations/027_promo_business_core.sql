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

CREATE OR REPLACE FUNCTION public.admin_save_promo_code(
    p_promo_id BIGINT,
    p_code TEXT,
    p_owner_user_id UUID,
    p_status TEXT,
    p_discount_type TEXT,
    p_discount_value NUMERIC,
    p_discount_currency TEXT,
    p_commission_type TEXT,
    p_commission_value NUMERIC,
    p_commission_currency TEXT,
    p_commission_basis TEXT,
    p_valid_from TIMESTAMPTZ,
    p_valid_until TIMESTAMPTZ,
    p_max_activations INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_code TEXT := upper(btrim(COALESCE(p_code, '')));
    v_status TEXT := lower(btrim(COALESCE(p_status, '')));
    v_discount_type TEXT := lower(btrim(COALESCE(p_discount_type, 'none')));
    v_discount_currency TEXT := NULLIF(upper(btrim(COALESCE(p_discount_currency, ''))), '');
    v_commission_type TEXT := lower(btrim(COALESCE(p_commission_type, 'none')));
    v_commission_currency TEXT := NULLIF(upper(btrim(COALESCE(p_commission_currency, ''))), '');
    v_commission_basis TEXT := lower(btrim(COALESCE(p_commission_basis, 'amount_paid')));
    v_promo public.promo_codes%ROWTYPE;
    v_action TEXT;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{1,31}$' THEN
        RAISE EXCEPTION 'INVALID_PROMO_CODE';
    END IF;

    IF v_status NOT IN ('active', 'inactive')
       OR v_discount_type NOT IN ('none', 'percentage', 'fixed', 'special_price')
       OR v_commission_type NOT IN ('none', 'percentage', 'fixed')
       OR v_commission_basis NOT IN ('amount_paid', 'agreed_price') THEN
        RAISE EXCEPTION 'INVALID_PROMO_RULE';
    END IF;

    IF p_valid_until IS NOT NULL AND p_valid_from IS NOT NULL AND p_valid_until <= p_valid_from THEN
        RAISE EXCEPTION 'INVALID_PROMO_WINDOW';
    END IF;

    IF p_max_activations IS NOT NULL AND p_max_activations <= 0 THEN
        RAISE EXCEPTION 'INVALID_PROMO_LIMIT';
    END IF;

    IF p_owner_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner_user_id) THEN
        RAISE EXCEPTION 'PROMO_OWNER_NOT_FOUND';
    END IF;

    IF v_discount_type = 'none' THEN
        IF p_discount_value IS NOT NULL OR v_discount_currency IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_PROMO_DISCOUNT';
        END IF;
    ELSE
        IF p_discount_value IS NULL OR p_discount_value < 0
           OR (v_discount_type = 'percentage' AND p_discount_value > 100) THEN
            RAISE EXCEPTION 'INVALID_PROMO_DISCOUNT';
        END IF;
        IF v_discount_type IN ('fixed', 'special_price') AND v_discount_currency IS NULL THEN
            RAISE EXCEPTION 'INVALID_PROMO_DISCOUNT';
        END IF;
        IF v_discount_type = 'percentage' THEN
            v_discount_currency := NULL;
        END IF;
    END IF;

    IF v_commission_type = 'none' THEN
        IF p_commission_value IS NOT NULL OR v_commission_currency IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_PROMO_COMMISSION';
        END IF;
    ELSE
        IF p_commission_value IS NULL OR p_commission_value < 0
           OR (v_commission_type = 'percentage' AND p_commission_value > 100) THEN
            RAISE EXCEPTION 'INVALID_PROMO_COMMISSION';
        END IF;
        IF v_commission_type = 'fixed' AND v_commission_currency IS NULL THEN
            RAISE EXCEPTION 'INVALID_PROMO_COMMISSION';
        END IF;
        IF v_commission_type = 'percentage' THEN
            v_commission_currency := NULL;
        END IF;
    END IF;

    IF p_promo_id IS NULL THEN
        INSERT INTO public.promo_codes (
            code,
            owner_user_id,
            status,
            discount_type,
            discount_value,
            discount_currency,
            commission_type,
            commission_value,
            commission_currency,
            commission_basis,
            valid_from,
            valid_until,
            max_activations,
            created_by
        ) VALUES (
            v_code,
            p_owner_user_id,
            v_status,
            v_discount_type,
            p_discount_value,
            v_discount_currency,
            v_commission_type,
            p_commission_value,
            v_commission_currency,
            v_commission_basis,
            p_valid_from,
            p_valid_until,
            p_max_activations,
            auth.uid()
        )
        RETURNING * INTO v_promo;
        v_action := 'promo_created';
    ELSE
        SELECT *
        INTO v_promo
        FROM public.promo_codes
        WHERE id = p_promo_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PROMO_NOT_FOUND';
        END IF;

        UPDATE public.promo_codes
        SET
            code = v_code,
            owner_user_id = p_owner_user_id,
            status = v_status,
            discount_type = v_discount_type,
            discount_value = p_discount_value,
            discount_currency = v_discount_currency,
            commission_type = v_commission_type,
            commission_value = p_commission_value,
            commission_currency = v_commission_currency,
            commission_basis = v_commission_basis,
            valid_from = p_valid_from,
            valid_until = p_valid_until,
            max_activations = p_max_activations
        WHERE id = p_promo_id
        RETURNING * INTO v_promo;
        v_action := 'promo_updated';
    END IF;

    PERFORM private.business_audit(
        v_action,
        'promo_code',
        v_promo.id::TEXT,
        jsonb_build_object(
            'code', v_promo.code,
            'status', v_promo.status,
            'owner_user_id', v_promo.owner_user_id,
            'discount_type', v_promo.discount_type,
            'commission_type', v_promo.commission_type
        )
    );

    RETURN jsonb_build_object(
        'id', v_promo.id,
        'code', v_promo.code,
        'status', v_promo.status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_revenue_summary(
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
    v_result JSONB;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    WITH currencies AS (
        SELECT currency FROM public.orders
        WHERE created_at >= p_from AND created_at < p_to AND status <> 'cancelled'
        UNION
        SELECT currency FROM public.payments
        WHERE paid_at >= p_from AND paid_at < p_to
           OR (refunded_at IS NOT NULL AND refunded_at >= p_from AND refunded_at < p_to)
        UNION
        SELECT currency FROM public.commissions
        WHERE created_at >= p_from AND created_at < p_to
    ),
    booked AS (
        SELECT
            currency,
            COUNT(*)::BIGINT AS orders_count,
            SUM(base_price)::NUMERIC AS gross_sales,
            SUM(discount_amount)::NUMERIC AS discounts,
            SUM(agreed_price)::NUMERIC AS booked_sales
        FROM public.orders
        WHERE created_at >= p_from
          AND created_at < p_to
          AND status <> 'cancelled'
        GROUP BY currency
    ),
    cash AS (
        SELECT
            currency,
            SUM(amount)::NUMERIC AS gross_collected
        FROM public.payments
        WHERE status IN ('confirmed', 'refunded')
          AND paid_at >= p_from
          AND paid_at < p_to
        GROUP BY currency
    ),
    refunds AS (
        SELECT
            currency,
            SUM(amount)::NUMERIC AS refunds
        FROM public.payments
        WHERE status = 'refunded'
          AND refunded_at >= p_from
          AND refunded_at < p_to
        GROUP BY currency
    ),
    commission_cost AS (
        SELECT
            currency,
            SUM(commission_amount)::NUMERIC AS commissions
        FROM public.commissions
        WHERE status IN ('approved', 'paid')
          AND created_at >= p_from
          AND created_at < p_to
        GROUP BY currency
    ),
    activations AS (
        SELECT
            order_row.currency,
            COUNT(*)::BIGINT AS activations,
            COUNT(DISTINCT order_row.user_id)::BIGINT AS unique_customers
        FROM public.orders order_row
        JOIN public.upgrade_requests request_row
          ON request_row.id = order_row.upgrade_request_id
        WHERE request_row.activated_at >= p_from
          AND request_row.activated_at < p_to
          AND order_row.status IN ('activated', 'refunded')
        GROUP BY order_row.currency
    ),
    rows AS (
        SELECT
            currency.currency,
            COALESCE(booked.orders_count, 0)::BIGINT AS orders_count,
            COALESCE(booked.gross_sales, 0)::NUMERIC AS gross_sales,
            COALESCE(booked.discounts, 0)::NUMERIC AS discounts,
            COALESCE(booked.booked_sales, 0)::NUMERIC AS booked_sales,
            COALESCE(cash.gross_collected, 0)::NUMERIC AS gross_collected,
            COALESCE(refunds.refunds, 0)::NUMERIC AS refunds,
            (COALESCE(cash.gross_collected, 0) - COALESCE(refunds.refunds, 0))::NUMERIC AS net_collected,
            COALESCE(commission_cost.commissions, 0)::NUMERIC AS commissions,
            (
                COALESCE(cash.gross_collected, 0)
                - COALESCE(refunds.refunds, 0)
                - COALESCE(commission_cost.commissions, 0)
            )::NUMERIC AS contribution_profit,
            COALESCE(activations.activations, 0)::BIGINT AS activations,
            COALESCE(activations.unique_customers, 0)::BIGINT AS unique_customers
        FROM currencies currency
        LEFT JOIN booked ON booked.currency = currency.currency
        LEFT JOIN cash ON cash.currency = currency.currency
        LEFT JOIN refunds ON refunds.currency = currency.currency
        LEFT JOIN commission_cost ON commission_cost.currency = currency.currency
        LEFT JOIN activations ON activations.currency = currency.currency
    )
    SELECT jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'currencies', COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'currency', rows.currency,
                    'orders_count', rows.orders_count,
                    'gross_sales', rows.gross_sales,
                    'discounts', rows.discounts,
                    'booked_sales', rows.booked_sales,
                    'gross_collected', rows.gross_collected,
                    'refunds', rows.refunds,
                    'net_collected', rows.net_collected,
                    'commissions', rows.commissions,
                    'contribution_profit', rows.contribution_profit,
                    'activations', rows.activations,
                    'unique_customers', rows.unique_customers
                )
                ORDER BY rows.currency
            ),
            '[]'::jsonb
        )
    )
    INTO v_result
    FROM rows;

    RETURN COALESCE(
        v_result,
        jsonb_build_object('from', p_from, 'to', p_to, 'currencies', '[]'::jsonb)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_commissions(
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    commission_id UUID,
    order_id UUID,
    promo_code TEXT,
    partner_user_id UUID,
    partner_name TEXT,
    partner_email TEXT,
    commission_amount NUMERIC,
    currency TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    settlement_id UUID,
    settlement_paid_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_status TEXT := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_status IS NOT NULL AND v_status NOT IN ('pending', 'approved', 'paid', 'reversed') THEN
        RAISE EXCEPTION 'INVALID_COMMISSION_STATUS';
    END IF;

    RETURN QUERY
    SELECT
        commission.id,
        commission.order_id,
        promo.code,
        commission.partner_user_id,
        partner.full_name,
        partner.email,
        commission.commission_amount,
        commission.currency,
        commission.status,
        commission.created_at,
        commission.approved_at,
        commission.paid_at,
        settlement.id,
        settlement.paid_at
    FROM public.commissions commission
    JOIN public.promo_codes promo
      ON promo.id = commission.promo_code_id
    JOIN public.profiles partner
      ON partner.id = commission.partner_user_id
    LEFT JOIN public.commission_settlement_items settlement_item
      ON settlement_item.commission_id = commission.id
    LEFT JOIN public.commission_settlements settlement
      ON settlement.id = settlement_item.settlement_id
    WHERE v_status IS NULL OR commission.status = v_status
    ORDER BY commission.created_at DESC
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_commission_settlement(
    p_commission_ids UUID[],
    p_payment_method TEXT,
    p_transaction_reference TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_method TEXT := btrim(COALESCE(p_payment_method, ''));
    v_requested_count INTEGER;
    v_found_count INTEGER;
    v_partner_count INTEGER;
    v_currency_count INTEGER;
    v_partner_user_id UUID;
    v_currency TEXT;
    v_amount NUMERIC(12,2);
    v_settlement public.commission_settlements%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    v_requested_count := COALESCE(array_length(p_commission_ids, 1), 0);
    IF v_requested_count < 1 OR v_requested_count > 200 OR char_length(v_method) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'INVALID_SETTLEMENT_INPUT';
    END IF;

    PERFORM 1
    FROM public.commissions
    WHERE id = ANY(p_commission_ids)
    ORDER BY id
    FOR UPDATE;

    SELECT
        COUNT(DISTINCT id)::INTEGER,
        COUNT(DISTINCT partner_user_id)::INTEGER,
        COUNT(DISTINCT currency)::INTEGER,
        MIN(partner_user_id),
        MIN(currency),
        SUM(commission_amount)::NUMERIC(12,2)
    INTO
        v_found_count,
        v_partner_count,
        v_currency_count,
        v_partner_user_id,
        v_currency,
        v_amount
    FROM public.commissions
    WHERE id = ANY(p_commission_ids)
      AND status = 'approved';

    IF v_found_count <> v_requested_count
       OR v_partner_count <> 1
       OR v_currency_count <> 1
       OR v_amount IS NULL
       OR v_amount <= 0 THEN
        RAISE EXCEPTION 'COMMISSIONS_NOT_SETTLEABLE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.commission_settlement_items
        WHERE commission_id = ANY(p_commission_ids)
    ) THEN
        RAISE EXCEPTION 'COMMISSION_ALREADY_SETTLED';
    END IF;

    INSERT INTO public.commission_settlements (
        partner_user_id,
        amount,
        currency,
        payment_method,
        transaction_reference,
        notes,
        created_by
    ) VALUES (
        v_partner_user_id,
        v_amount,
        v_currency,
        v_method,
        NULLIF(btrim(COALESCE(p_transaction_reference, '')), ''),
        NULLIF(btrim(COALESCE(p_notes, '')), ''),
        auth.uid()
    )
    RETURNING * INTO v_settlement;

    INSERT INTO public.commission_settlement_items (
        settlement_id,
        commission_id,
        amount
    )
    SELECT
        v_settlement.id,
        commission.id,
        commission.commission_amount
    FROM public.commissions commission
    WHERE commission.id = ANY(p_commission_ids);

    UPDATE public.commissions
    SET
        status = 'paid',
        paid_at = v_settlement.paid_at
    WHERE id = ANY(p_commission_ids);

    PERFORM private.business_audit(
        'commission_settlement_paid',
        'commission_settlement',
        v_settlement.id::TEXT,
        jsonb_build_object(
            'partner_user_id', v_settlement.partner_user_id,
            'amount', v_settlement.amount,
            'currency', v_settlement.currency,
            'commission_count', v_requested_count
        )
    );

    RETURN jsonb_build_object(
        'settlement_id', v_settlement.id,
        'partner_user_id', v_settlement.partner_user_id,
        'amount', v_settlement.amount,
        'currency', v_settlement.currency,
        'commission_count', v_requested_count,
        'paid_at', v_settlement.paid_at
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
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
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
        SET expires_at = LEAST(COALESCE(expires_at, v_now), v_now)
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

REVOKE ALL ON FUNCTION public.partner_get_coupon_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_promo_codes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_promo_code(BIGINT, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_revenue_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_commissions(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_commission_settlement(UUID[], TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_refund_upgrade_order(UUID, TEXT, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.partner_get_coupon_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_promo_codes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_promo_code(BIGINT, TEXT, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_revenue_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_commissions(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_commission_settlement(UUID[], TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_upgrade_order(UUID, TEXT, BOOLEAN) TO authenticated;

COMMENT ON TABLE public.commission_settlements IS
    'Admin-recorded partner commission payouts. Promo owners cannot read this ledger.';
COMMENT ON FUNCTION public.partner_get_coupon_summary() IS
    'Returns only coupon code and unique successful activated-user count for the signed-in coupon owner.';
