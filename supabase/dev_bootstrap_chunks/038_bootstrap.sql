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

CREATE OR REPLACE FUNCTION private.catalog_pin_extension_target()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
BEGIN
    IF NEW.quote_snapshot IS NULL
       OR COALESCE(NEW.quote_snapshot->>'mode', '') <> 'extension'
       OR NULLIF(NEW.quote_snapshot->>'extension_grant_id', '') IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT grant_row.* INTO v_grant
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = NEW.user_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND grant_row.expires_at IS NOT NULL
      AND grant_row.expires_at > now()
      AND (
          (NEW.scope_type = 'global' AND grant_row.scope_type = 'global')
          OR (
              NEW.scope_type = 'pathway'
              AND grant_row.scope_type = 'pathway'
              AND grant_row.pathway_id = NEW.pathway_id
          )
          OR (
              NEW.scope_type = 'bank'
              AND grant_row.scope_type = 'bank'
              AND grant_row.question_bank_id = NEW.question_bank_id
          )
      )
    ORDER BY grant_row.expires_at DESC, grant_row.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXTENSION_TARGET_NOT_ACTIVE';
    END IF;

    NEW.quote_snapshot := NEW.quote_snapshot || jsonb_build_object(
        'extension_grant_id', v_grant.id,
        'access_expires_at_at_request', v_grant.expires_at
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER upgrade_requests_pin_catalog_extension
BEFORE INSERT OR UPDATE OF quote_snapshot ON public.upgrade_requests
FOR EACH ROW EXECUTE FUNCTION private.catalog_pin_extension_target();

-- Production contains a few historical SECURITY DEFINER helpers that are not all
-- recreated by a clean migration rebuild. Harden every legacy signature when it
-- exists, while preserving the authenticated contract used by Royal RLS/RPCs.
DO $$
DECLARE
    v_signature TEXT;
    v_signatures TEXT[] := ARRAY[
        'public.audit_bank_access_change()',
        'public.audit_profile_access_change()',
        'public.can_access_question(bigint)',
        'public.can_access_question_bank(bigint)',
        'public.can_read_locked_session(uuid)',
        'public.enforce_answer_finalization()',
        'public.enforce_free_trial_session_quota()',
        'public.enforce_test_session_update_integrity()',
        'public.get_category_topic_counts(integer)',
        'public.get_category_topic_counts_json(bigint)',
        'public.get_user_category_analytics(uuid)',
        'public.handle_new_user()',
        'public.has_premium_question_bank_access(bigint)',
        'public.is_active_user()',
        'public.is_admin()',
        'public.is_support_or_admin()',
        'public.record_free_trial_session_usage()',
        'public.rls_auto_enable()',
        'public.set_ip_block_actor()',
        'public.validate_user_answer_relationships()',
        'public.validate_user_question_write_access()'
    ];
BEGIN
    FOREACH v_signature IN ARRAY v_signatures LOOP
        IF to_regprocedure(v_signature) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
        END IF;
    END LOOP;
END;
$$;

-- Release E follow-up: make disabling a bank trial satisfy the canonical
-- question_banks trial shape and validate limits before the table constraints
-- are reached. Also index the four catalog audit foreign keys introduced in
-- Release E so the release does not add new unindexed-FK advisor debt.

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
    v_enabled BOOLEAN := COALESCE(p_is_free_trial, FALSE);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_question_limit IS NULL
       OR p_question_limit NOT BETWEEN 1 AND 70
       OR p_article_limit IS NULL
       OR p_article_limit < 0
       OR (v_enabled AND (p_block_limit IS NULL OR p_block_limit < 0)) THEN
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
        is_free_trial = v_enabled,
        free_trial_block_limit = CASE WHEN v_enabled THEN p_block_limit ELSE NULL END,
        free_trial_question_limit = p_question_limit,
        free_trial_article_limit = p_article_limit
    WHERE id = p_bank_id
    RETURNING * INTO v_bank;

    UPDATE public.pathways pathway
    SET is_free_trial_available = EXISTS (
        SELECT 1
        FROM public.question_banks bank
        WHERE bank.pathway_id = pathway.id
          AND bank.is_free_trial
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

REVOKE ALL ON FUNCTION public.admin_update_catalog_bank_trial(BIGINT, BOOLEAN, INTEGER, INTEGER, INTEGER)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_update_catalog_bank_trial(BIGINT, BOOLEAN, INTEGER, INTEGER, INTEGER)
TO authenticated;

CREATE INDEX IF NOT EXISTS catalog_products_created_by_idx
    ON public.catalog_products (created_by)
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_products_updated_by_idx
    ON public.catalog_products (updated_by)
    WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_plans_created_by_idx
    ON public.catalog_plans (created_by)
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_plans_updated_by_idx
    ON public.catalog_plans (updated_by)
    WHERE updated_by IS NOT NULL;
