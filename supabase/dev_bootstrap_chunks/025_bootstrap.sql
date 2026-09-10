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

-- PostgreSQL does not provide min(uuid). The settlement function already verifies
-- that the selected rows contain exactly one partner, so selecting the textual
-- minimum and casting it back to UUID is deterministic and safe.

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
        MIN(partner_user_id::TEXT)::UUID,
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

REVOKE ALL ON FUNCTION public.admin_create_commission_settlement(UUID[], TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_commission_settlement(UUID[], TEXT, TEXT, TEXT) TO authenticated;

-- Preserve access-grant history while making revoked grants immediately ineligible.
-- user_access_grants remains the sole premium entitlement authority; revoked rows
-- stay in that ledger but are excluded by every active-entitlement predicate.

ALTER TABLE public.user_access_grants
    ADD COLUMN revoked_at TIMESTAMPTZ,
    ADD COLUMN revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN revoke_reason TEXT;

ALTER TABLE public.user_access_grants
    ADD CONSTRAINT user_access_grants_revocation_shape
    CHECK (
        revoked_at IS NULL
        OR (revoked_by IS NOT NULL AND revoke_reason IS NOT NULL AND btrim(revoke_reason) <> '')
    );

COMMENT ON COLUMN public.user_access_grants.revoked_at IS
    'When set, this historical grant no longer provides premium entitlement.';

COMMENT ON COLUMN public.user_access_grants.revoked_by IS
    'Support/admin actor that revoked this historical grant.';

COMMENT ON COLUMN public.user_access_grants.revoke_reason IS
    'Auditable reason the grant stopped providing entitlement.';

DROP INDEX IF EXISTS public.idx_user_access_grants_user_active;

CREATE INDEX idx_user_access_grants_user_active
    ON public.user_access_grants (user_id, scope_type, starts_at, expires_at)
    WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.has_premium_question_bank_access(p_bank_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND (
            public.is_support_or_admin()
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_access_grants grant_row
                  ON grant_row.user_id = auth.uid()
                 AND grant_row.revoked_at IS NULL
                 AND grant_row.starts_at <= now()
                 AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
                 AND (
                     grant_row.scope_type = 'global'
                     OR (
                         grant_row.scope_type = 'pathway'
                         AND grant_row.pathway_id = qb.pathway_id
                     )
                     OR (
                         grant_row.scope_type = 'bank'
                         AND grant_row.question_bank_id = qb.id
                     )
                 )
                WHERE qb.id = p_bank_id
            )
        );
$$;

CREATE OR REPLACE FUNCTION private.business_user_has_covering_grant(
    p_user_id UUID,
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_bank_pathway_id BIGINT;
BEGIN
    IF p_scope_type = 'bank' THEN
        SELECT pathway_id
        INTO v_bank_pathway_id
        FROM public.question_banks
        WHERE id = p_bank_id;

        IF NOT FOUND THEN
            RETURN FALSE;
        END IF;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = p_user_id
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= now()
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
          AND (
              grant_row.scope_type = 'global'
              OR (
                  p_scope_type = 'pathway'
                  AND grant_row.scope_type = 'pathway'
                  AND grant_row.pathway_id = p_pathway_id
              )
              OR (
                  p_scope_type = 'bank'
                  AND (
                      (
                          grant_row.scope_type = 'pathway'
                          AND grant_row.pathway_id = v_bank_pathway_id
                      )
                      OR (
                          grant_row.scope_type = 'bank'
                          AND grant_row.question_bank_id = p_bank_id
                      )
                  )
              )
          )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_access(p_grant_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
    v_now TIMESTAMPTZ := timezone('utc'::text, clock_timestamp());
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    SELECT *
    INTO v_grant
    FROM public.user_access_grants
    WHERE id = p_grant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access grant not found';
    END IF;

    IF v_grant.revoked_at IS NOT NULL THEN
        RETURN;
    END IF;

    UPDATE public.user_access_grants
    SET
        revoked_at = v_now,
        revoked_by = auth.uid(),
        revoke_reason = 'manual_revoke'
    WHERE id = p_grant_id;

    PERFORM private.business_audit(
        'access_grant_revoked',
        'user_access_grant',
        p_grant_id::TEXT,
        jsonb_build_object(
            'user_id', v_grant.user_id,
            'scope_type', v_grant.scope_type,
            'pathway_id', v_grant.pathway_id,
            'question_bank_id', v_grant.question_bank_id,
            'reason', 'manual_revoke'
        )
    );
END;
$$;
