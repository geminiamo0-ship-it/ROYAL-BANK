SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE OR REPLACE FUNCTION public.support_get_upgrade_request(
    p_request_id UUID
)
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

CREATE OR REPLACE FUNCTION public.support_mark_upgrade_contacted(
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

    IF v_request.status = 'cancelled' THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_CANCELLED';
    END IF;

    IF v_request.status = 'pending' THEN
        UPDATE public.upgrade_requests
        SET
            status = 'contacted',
            contacted_at = COALESCE(contacted_at, timezone('utc'::text, now())),
            contacted_by = COALESCE(contacted_by, auth.uid())
        WHERE id = v_request.id
        RETURNING * INTO v_request;

        PERFORM private.business_audit(
            'upgrade_request_contacted',
            'upgrade_request',
            v_request.id::TEXT,
            jsonb_build_object('public_code', v_request.public_code)
        );
    END IF;

    RETURN jsonb_build_object(
        'request_id', v_request.id,
        'status', v_request.status
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
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_promo public.promo_codes%ROWTYPE;
    v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
    v_snapshot JSONB := NULL;
    v_had_order BOOLEAN := FALSE;
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

    SELECT *
    INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    IF v_request.status IN ('paid', 'activated', 'cancelled') THEN
        RAISE EXCEPTION 'ORDER_LOCKED';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE upgrade_request_id = v_request.id
    FOR UPDATE;

    v_had_order := FOUND;

    IF v_had_order AND EXISTS (
        SELECT 1
        FROM public.payments
        WHERE order_id = v_order.id
          AND status = 'confirmed'
    ) THEN
        RAISE EXCEPTION 'ORDER_LOCKED';
    END IF;

    IF v_request.promo_code_id IS NOT NULL THEN
        SELECT *
        INTO v_promo
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
            upgrade_request_id,
            user_id,
            scope_type,
            pathway_id,
            question_bank_id,
            duration_months,
            base_price,
            discount_amount,
            agreed_price,
            currency,
            promo_code_id,
            promo_rule_snapshot,
            internal_notes,
            created_by
        ) VALUES (
            v_request.id,
            v_request.user_id,
            v_request.scope_type,
            v_request.pathway_id,
            v_request.question_bank_id,
            p_duration_months,
            p_base_price,
            p_discount_amount,
            p_agreed_price,
            v_currency,
            v_request.promo_code_id,
            v_snapshot,
            NULLIF(btrim(COALESCE(p_internal_notes, '')), ''),
            auth.uid()
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
            'duration_months', v_order.duration_months
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

CREATE OR REPLACE FUNCTION public.support_record_upgrade_payment(
    p_request_id UUID,
    p_amount NUMERIC,
    p_currency TEXT,
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
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
    v_method TEXT := btrim(COALESCE(p_payment_method, ''));
    v_paid NUMERIC(12,2);
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0
       OR v_currency !~ '^[A-Z]{3}$'
       OR char_length(v_method) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'INVALID_PAYMENT_VALUES';
    END IF;

    SELECT *
    INTO v_request
    FROM public.upgrade_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_FOUND';
    END IF;

    IF v_request.status IN ('activated', 'cancelled') THEN
        RAISE EXCEPTION 'PAYMENT_LOCKED';
    END IF;

    SELECT *
    INTO v_order
    FROM public.orders
    WHERE upgrade_request_id = v_request.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_REQUIRED';
    END IF;

    IF v_order.status IN ('activated', 'cancelled', 'refunded') THEN
        RAISE EXCEPTION 'PAYMENT_LOCKED';
    END IF;

    IF v_currency <> v_order.currency THEN
        RAISE EXCEPTION 'PAYMENT_CURRENCY_MISMATCH';
    END IF;

    INSERT INTO public.payments (
        order_id,
        amount,
        currency,
        payment_method,
        transaction_reference,
        notes,
        recorded_by,
        verified_by
    ) VALUES (
        v_order.id,
        p_amount,
        v_currency,
        v_method,
        NULLIF(btrim(COALESCE(p_transaction_reference, '')), ''),
        NULLIF(btrim(COALESCE(p_notes, '')), ''),
        auth.uid(),
        auth.uid()
    )
    RETURNING * INTO v_payment;

    SELECT COALESCE(sum(amount), 0)
    INTO v_paid
    FROM public.payments
    WHERE order_id = v_order.id
      AND status = 'confirmed';

    IF v_paid >= v_order.agreed_price THEN
        UPDATE public.orders
        SET status = 'paid'
        WHERE id = v_order.id;

        UPDATE public.upgrade_requests
        SET status = 'paid'
        WHERE id = v_request.id;
    END IF;

    PERFORM private.business_audit(
        'upgrade_payment_recorded',
        'payment',
        v_payment.id::TEXT,
        jsonb_build_object(
            'order_id', v_order.id,
            'request_id', v_request.id,
            'amount', v_payment.amount,
            'currency', v_payment.currency,
            'payment_method', v_payment.payment_method
        )
    );

    RETURN jsonb_build_object(
        'payment_id', v_payment.id,
        'paid_amount', v_paid,
        'agreed_price', v_order.agreed_price,
        'amount_due', GREATEST(v_order.agreed_price - v_paid, 0),
        'paid_enough', v_paid >= v_order.agreed_price
    );
END;
$$;
