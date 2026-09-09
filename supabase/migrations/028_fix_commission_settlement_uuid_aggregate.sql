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
