BEGIN;

-- Royal subscriptions have one authoritative entitlement source:
-- public.user_access_grants.  A user may have historical expired/revoked grants,
-- but may not hold more than one live or scheduled commercial subscription.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.user_access_grants
        WHERE revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
        GROUP BY user_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'PREEXISTING_MULTIPLE_LIVE_SUBSCRIPTIONS';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.upgrade_requests
        WHERE status IN ('pending', 'contacted', 'paid')
        GROUP BY user_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'PREEXISTING_MULTIPLE_OPEN_UPGRADE_REQUESTS';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payments
        WHERE NULLIF(btrim(transaction_reference), '') IS NOT NULL
        GROUP BY lower(btrim(transaction_reference))
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'PREEXISTING_DUPLICATE_PAYMENT_REFERENCE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        JOIN public.orders order_row
          ON order_row.upgrade_request_id = request_row.id
        WHERE request_row.status IN ('pending', 'contacted', 'paid')
          AND COALESCE(request_row.quote_snapshot->>'mode', '') <> 'extension'
          AND EXISTS (
              SELECT 1
              FROM public.user_access_grants grant_row
              WHERE grant_row.user_id = request_row.user_id
                AND grant_row.revoked_at IS NULL
                AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
          )
          AND EXISTS (
              SELECT 1
              FROM public.payments payment
              WHERE payment.order_id = order_row.id
                AND payment.status = 'confirmed'
                AND payment.amount > 0
          )
    ) THEN
        RAISE EXCEPTION 'PAID_OPEN_REQUEST_CONFLICT_REQUIRES_MANUAL_REVIEW';
    END IF;
END;
$$;

-- Cancel legacy unpaid upgrade requests that conflict with an already-live
-- subscription.  Paid conflicts fail the preflight above and require review.
DO $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
BEGIN
    FOR v_request IN
        SELECT request_row.*
        FROM public.upgrade_requests request_row
        WHERE request_row.status IN ('pending', 'contacted', 'paid')
          AND COALESCE(request_row.quote_snapshot->>'mode', '') <> 'extension'
          AND EXISTS (
              SELECT 1
              FROM public.user_access_grants grant_row
              WHERE grant_row.user_id = request_row.user_id
                AND grant_row.revoked_at IS NULL
                AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.orders order_row
              JOIN public.payments payment ON payment.order_id = order_row.id
              WHERE order_row.upgrade_request_id = request_row.id
                AND payment.status = 'confirmed'
                AND payment.amount > 0
          )
        FOR UPDATE
    LOOP
        UPDATE public.orders
        SET status = 'cancelled'
        WHERE upgrade_request_id = v_request.id
          AND status IN ('awaiting_payment', 'paid');

        UPDATE public.upgrade_requests
        SET status = 'cancelled',
            cancelled_at = timezone('utc'::text, now()),
            cancelled_by = NULL,
            cancel_reason = 'Automatically cancelled during single-subscription hardening because the account already has live premium access.'
        WHERE id = v_request.id;

        PERFORM private.business_audit(
            'upgrade_request_auto_cancelled_single_subscription',
            'upgrade_request',
            v_request.id::TEXT,
            jsonb_build_object(
                'previous_status', v_request.status,
                'scope_type', v_request.scope_type,
                'catalog_product_id', v_request.catalog_product_id
            )
        );
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_single_subscription_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NEW.revoked_at IS NOT NULL
       OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= now()) THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:subscription:' || NEW.user_id::TEXT, 0)
    );

    IF EXISTS (
        SELECT 1
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = NEW.user_id
          AND grant_row.id <> COALESCE(NEW.id, -1)
          AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ) THEN
        RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_access_grants_one_subscription
ON public.user_access_grants;

CREATE TRIGGER user_access_grants_one_subscription
BEFORE INSERT OR UPDATE OF user_id, starts_at, expires_at, revoked_at
ON public.user_access_grants
FOR EACH ROW
EXECUTE FUNCTION private.enforce_single_subscription_window();

REVOKE ALL ON FUNCTION private.enforce_single_subscription_window()
FROM PUBLIC, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS upgrade_requests_one_open_user_uidx
ON public.upgrade_requests (user_id)
WHERE status IN ('pending', 'contacted', 'paid');

CREATE UNIQUE INDEX IF NOT EXISTS payments_transaction_reference_uidx
ON public.payments ((lower(btrim(transaction_reference))))
WHERE NULLIF(btrim(transaction_reference), '') IS NOT NULL;

-- This is an internal primitive used by audited admin/support activation
-- wrappers.  A Support JWT must never call it directly through PostgREST.
REVOKE EXECUTE ON FUNCTION public.grant_user_access(
    uuid, text, bigint, bigint, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_my_access(
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL
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
    v_bank_pathway_id BIGINT;
    v_grant public.user_access_grants%ROWTYPE;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    IF v_scope = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSIF v_scope = 'pathway' THEN
        IF p_pathway_id IS NULL
           OR p_bank_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSIF v_scope = 'bank' THEN
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
        SELECT pathway_id
        INTO v_bank_pathway_id
        FROM public.question_banks
        WHERE id = p_bank_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSE
        RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
    END IF;

    -- Only a real broader entitlement counts as broader coverage.
    IF v_scope IN ('pathway', 'bank') THEN
        SELECT grant_row.*
        INTO v_grant
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = v_user_id
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= now()
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
          AND (
              grant_row.scope_type = 'global'
              OR (
                  v_scope = 'bank'
                  AND grant_row.scope_type = 'pathway'
                  AND grant_row.pathway_id = v_bank_pathway_id
              )
          )
        ORDER BY (grant_row.expires_at IS NULL) DESC,
                 grant_row.expires_at DESC NULLS FIRST,
                 grant_row.id DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'has_access', TRUE,
                'coverage_kind', 'broader',
                'can_extend', FALSE,
                'expires_soon', v_grant.expires_at IS NOT NULL
                    AND v_grant.expires_at <= now() + interval '30 days',
                'grant_id', v_grant.id,
                'scope_type', v_grant.scope_type,
                'pathway_id', v_grant.pathway_id,
                'question_bank_id', v_grant.question_bank_id,
                'starts_at', v_grant.starts_at,
                'expires_at', v_grant.expires_at,
                'is_lifetime', v_grant.expires_at IS NULL
            );
        END IF;
    END IF;

    SELECT grant_row.*
    INTO v_grant
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = v_user_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      AND (
          (v_scope = 'global' AND grant_row.scope_type = 'global')
          OR (
              v_scope = 'pathway'
              AND grant_row.scope_type = 'pathway'
              AND grant_row.pathway_id = p_pathway_id
          )
          OR (
              v_scope = 'bank'
              AND grant_row.scope_type = 'bank'
              AND grant_row.question_bank_id = p_bank_id
          )
      )
    ORDER BY (grant_row.expires_at IS NULL) DESC,
             grant_row.expires_at DESC NULLS FIRST,
             grant_row.id DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'has_access', TRUE,
            'coverage_kind', 'exact',
            'can_extend', v_grant.expires_at IS NOT NULL,
            'expires_soon', v_grant.expires_at IS NOT NULL
                AND v_grant.expires_at <= now() + interval '30 days',
            'grant_id', v_grant.id,
            'scope_type', v_grant.scope_type,
            'pathway_id', v_grant.pathway_id,
            'question_bank_id', v_grant.question_bank_id,
            'starts_at', v_grant.starts_at,
            'expires_at', v_grant.expires_at,
            'is_lifetime', v_grant.expires_at IS NULL
        );
    END IF;

    -- Bank grants deliberately do NOT synthesize pathway ownership, even if
    -- they happen to cover every bank that exists today. A pathway grant is
    -- what guarantees future banks in that pathway.
    RETURN jsonb_build_object(
        'has_access', FALSE,
        'coverage_kind', 'none',
        'can_extend', FALSE,
        'expires_soon', FALSE,
        'grant_id', NULL,
        'scope_type', NULL,
        'pathway_id', NULL,
        'question_bank_id', NULL,
        'starts_at', NULL,
        'expires_at', NULL,
        'is_lifetime', FALSE
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
    v_exact_grant_id BIGINT;
    v_has_other_subscription BOOLEAN := FALSE;
    v_has_any_subscription BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    v_quote := private.catalog_quote(p_plan_id, v_code);
    v_product_id := (v_quote->>'product_id')::BIGINT;
    v_product_type := v_quote->>'product_type';
    v_pathway_id := NULLIF(v_quote->>'pathway_id', '')::BIGINT;
    v_bank_id := NULLIF(v_quote->>'question_bank_id', '')::BIGINT;

    -- One serialization key across every Royal product for this customer.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:subscription:' || v_user_id::TEXT, 0)
    );

    v_access := public.resolve_my_access(v_product_type, v_pathway_id, v_bank_id);

    IF COALESCE((v_access->>'has_access')::BOOLEAN, FALSE) THEN
        IF v_access->>'coverage_kind' = 'exact'
           AND COALESCE((v_access->>'can_extend')::BOOLEAN, FALSE) THEN
            v_exact_grant_id := NULLIF(v_access->>'grant_id', '')::BIGINT;
            SELECT EXISTS (
                SELECT 1
                FROM public.user_access_grants grant_row
                WHERE grant_row.user_id = v_user_id
                  AND grant_row.revoked_at IS NULL
                  AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
                  AND grant_row.id <> v_exact_grant_id
            ) INTO v_has_other_subscription;

            IF v_has_other_subscription THEN
                RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS';
            END IF;
            v_mode := 'extension';
        ELSIF v_access->>'coverage_kind' = 'exact'
           AND COALESCE((v_access->>'is_lifetime')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION 'ACCESS_ALREADY_LIFETIME';
        ELSE
            RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS';
        END IF;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM public.user_access_grants grant_row
            WHERE grant_row.user_id = v_user_id
              AND grant_row.revoked_at IS NULL
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
        ) INTO v_has_any_subscription;

        IF v_has_any_subscription THEN
            RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS';
        END IF;
        v_mode := 'upgrade';
    END IF;

    SELECT request_row.*
    INTO v_existing
    FROM public.upgrade_requests request_row
    WHERE request_row.user_id = v_user_id
      AND request_row.status IN ('pending', 'contacted', 'paid')
    ORDER BY request_row.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF p_replace_request_id IS NULL AND FOUND THEN
        IF v_existing.catalog_product_id = v_product_id
           AND v_existing.catalog_plan_id = p_plan_id
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
                'base_price', CASE WHEN COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE)
                    THEN NULLIF(v_existing.quote_snapshot->>'base_price', '')::NUMERIC ELSE NULL END,
                'discount_amount', CASE WHEN COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE)
                    THEN NULLIF(v_existing.quote_snapshot->>'discount_amount', '')::NUMERIC ELSE NULL END,
                'final_price', CASE WHEN COALESCE((v_existing.quote_snapshot->>'price_visible')::BOOLEAN, FALSE)
                    THEN NULLIF(v_existing.quote_snapshot->>'final_price', '')::NUMERIC ELSE NULL END,
                'promo_applied', v_existing.promo_code_id IS NOT NULL,
                'existing', TRUE
            );
        END IF;
        RAISE EXCEPTION 'UPGRADE_REQUEST_ALREADY_PENDING';
    END IF;

    IF p_replace_request_id IS NOT NULL THEN
        SELECT request_row.*
        INTO v_replace
        FROM public.upgrade_requests request_row
        WHERE request_row.id = p_replace_request_id
          AND request_row.user_id = v_user_id
          AND request_row.catalog_product_id = v_product_id
        FOR UPDATE;

        IF NOT FOUND OR v_replace.status NOT IN ('pending', 'contacted') THEN
            RAISE EXCEPTION 'UPGRADE_REQUEST_NOT_REPLACEABLE';
        END IF;

        SELECT *
        INTO v_replace_order
        FROM public.orders order_row
        WHERE order_row.upgrade_request_id = v_replace.id
        FOR UPDATE;

        IF FOUND AND EXISTS (
            SELECT 1
            FROM public.payments payment
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
        SET status = 'cancelled',
            cancelled_at = timezone('utc'::text, now()),
            cancelled_by = v_user_id,
            cancel_reason = 'Replaced by customer with a different catalog plan.'
        WHERE id = v_replace.id;
    END IF;

    v_quote := v_quote || jsonb_build_object(
        'mode', v_mode,
        'quoted_at', timezone('utc'::text, now())
    );

    FOR v_attempt IN 1..12 LOOP
        v_public_code := 'RY-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.upgrade_requests WHERE public_code = v_public_code
        );
        v_public_code := NULL;
    END LOOP;
    IF v_public_code IS NULL THEN
        RAISE EXCEPTION 'REQUEST_CODE_GENERATION_FAILED';
    END IF;

    INSERT INTO public.upgrade_requests (
        public_code,
        user_id,
        scope_type,
        pathway_id,
        question_bank_id,
        promo_code_id,
        promo_code_entered,
        catalog_product_id,
        catalog_plan_id,
        quote_snapshot,
        replaced_request_id
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
        CASE WHEN v_mode = 'extension'
            THEN 'catalog_extension_requested'
            ELSE 'catalog_upgrade_requested'
        END,
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
        'base_price', CASE WHEN COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE)
            THEN NULLIF(v_quote->>'base_price', '')::NUMERIC ELSE NULL END,
        'discount_amount', CASE WHEN COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE)
            THEN NULLIF(v_quote->>'discount_amount', '')::NUMERIC ELSE NULL END,
        'final_price', CASE WHEN COALESCE((v_quote->>'price_visible')::BOOLEAN, FALSE)
            THEN NULLIF(v_quote->>'final_price', '')::NUMERIC ELSE NULL END,
        'promo_applied', NULLIF(v_quote->>'promo_code_id', '') IS NOT NULL,
        'existing', FALSE
    );
END;
$$;

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
    v_has_subscription BOOLEAN := FALSE;
    v_has_other_open_request BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    SELECT *
    INTO v_product
    FROM public.catalog_products product
    WHERE product.status = 'active'
      AND (
          (v_scope = 'global' AND p_target_id IS NULL AND product.product_type = 'global')
          OR (
              v_scope = 'pathway'
              AND product.product_type = 'pathway'
              AND product.pathway_id = p_target_id
          )
          OR (
              v_scope = 'bank'
              AND product.product_type = 'bank'
              AND product.question_bank_id = p_target_id
          )
      )
    LIMIT 1;

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.catalog_plans plan_row
        WHERE plan_row.product_id = v_product.id
          AND plan_row.status = 'active'
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
                'price_visible', v_product.show_prices
                    AND plan_row.show_price
                    AND plan_row.price IS NOT NULL,
                'price', CASE
                    WHEN v_product.show_prices AND plan_row.show_price
                    THEN plan_row.price
                    ELSE NULL
                END,
                'is_default', plan_row.is_default,
                'is_recommended', plan_row.is_recommended,
                'display_order', plan_row.display_order,
                'version', plan_row.version
            )
            ORDER BY plan_row.display_order, plan_row.id
        ),
        '[]'::JSONB
    )
    INTO v_plans
    FROM public.catalog_plans plan_row
    WHERE plan_row.product_id = v_product.id
      AND plan_row.status = 'active';

    SELECT request_row.*
    INTO v_pending
    FROM public.upgrade_requests request_row
    WHERE request_row.user_id = v_user_id
      AND request_row.catalog_product_id = v_product.id
      AND request_row.status IN ('pending', 'contacted', 'paid')
    ORDER BY request_row.created_at DESC
    LIMIT 1;

    IF FOUND THEN
        v_pending_snapshot := v_pending.quote_snapshot;

        SELECT *
        INTO v_pending_order
        FROM public.orders order_row
        WHERE order_row.upgrade_request_id = v_pending.id;

        IF FOUND THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.payments payment
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
            'base_price', CASE WHEN COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE)
                THEN NULLIF(v_pending_snapshot->>'base_price', '')::NUMERIC ELSE NULL END,
            'discount_amount', CASE WHEN COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE)
                THEN NULLIF(v_pending_snapshot->>'discount_amount', '')::NUMERIC ELSE NULL END,
            'final_price', CASE WHEN COALESCE((v_pending_snapshot->>'price_visible')::BOOLEAN, FALSE)
                THEN NULLIF(v_pending_snapshot->>'final_price', '')::NUMERIC ELSE NULL END,
            'promo_code', v_pending.promo_code_entered,
            'legacy', v_pending.catalog_plan_id IS NULL OR v_pending.quote_snapshot IS NULL,
            'can_cancel', v_pending.status IN ('pending', 'contacted') AND NOT v_has_payment,
            'can_change', v_pending.status IN ('pending', 'contacted')
                AND NOT v_has_payment
                AND v_pending.catalog_plan_id IS NOT NULL
                AND v_pending.quote_snapshot IS NOT NULL
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = v_user_id
          AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ) INTO v_has_subscription;

    SELECT EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        WHERE request_row.user_id = v_user_id
          AND request_row.status IN ('pending', 'contacted', 'paid')
          AND request_row.catalog_product_id IS DISTINCT FROM v_product.id
    ) INTO v_has_other_open_request;

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
    ELSIF v_has_subscription OR v_has_other_open_request THEN
        v_mode := 'active';
        v_can_request := FALSE;
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
    v_has_subscription BOOLEAN := FALSE;
    v_has_open_request BOOLEAN := FALSE;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = v_user_id
          AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ) INTO v_has_subscription;

    SELECT EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        WHERE request_row.user_id = v_user_id
          AND request_row.status IN ('pending', 'contacted', 'paid')
    ) INTO v_has_open_request;

    v_access := public.resolve_my_access('global', NULL, NULL);
    SELECT jsonb_build_object(
        'access', v_access,
        'catalog_available', EXISTS (
            SELECT 1
            FROM public.catalog_products product
            WHERE product.product_type = 'global'
              AND product.status = 'active'
              AND EXISTS (
                  SELECT 1
                  FROM public.catalog_plans plan_row
                  WHERE plan_row.product_id = product.id
                    AND plan_row.status = 'active'
              )
        )
    ) INTO v_global;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', pathway.id,
                'access', public.resolve_my_access('pathway', pathway.id, NULL),
                'catalog_available', EXISTS (
                    SELECT 1
                    FROM public.catalog_products product
                    WHERE product.product_type = 'pathway'
                      AND product.pathway_id = pathway.id
                      AND product.status = 'active'
                      AND EXISTS (
                          SELECT 1
                          FROM public.catalog_plans plan_row
                          WHERE plan_row.product_id = product.id
                            AND plan_row.status = 'active'
                      )
                )
            )
            ORDER BY COALESCE(pathway.display_order, 0), pathway.id
        ),
        '[]'::JSONB
    ) INTO v_pathways
    FROM public.pathways pathway;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', bank.id,
                'access', public.resolve_my_access('bank', NULL, bank.id),
                'catalog_available', EXISTS (
                    SELECT 1
                    FROM public.catalog_products product
                    WHERE product.product_type = 'bank'
                      AND product.question_bank_id = bank.id
                      AND product.status = 'active'
                      AND EXISTS (
                          SELECT 1
                          FROM public.catalog_plans plan_row
                          WHERE plan_row.product_id = product.id
                            AND plan_row.status = 'active'
                      )
                ),
                'unlocked', public.can_access_question_bank(bank.id),
                'question_count', (
                    SELECT count(*)
                    FROM public.question_bank_questions mapping
                    WHERE mapping.question_bank_id = bank.id
                ),
                'article_count', (
                    SELECT count(*)
                    FROM public.question_bank_library_articles article
                    WHERE article.question_bank_id = bank.id
                )
            )
            ORDER BY COALESCE(bank.display_order, 0), bank.id
        ),
        '[]'::JSONB
    ) INTO v_banks
    FROM public.question_banks bank;

    RETURN jsonb_build_object(
        'global', v_global,
        'pathways', v_pathways,
        'banks', v_banks,
        'commerce_locked', v_has_subscription OR v_has_open_request,
        'commerce_lock_reason', CASE
            WHEN v_has_subscription THEN 'subscription'
            WHEN v_has_open_request THEN 'request'
            ELSE NULL
        END,
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
                )
                ORDER BY grant_row.created_at DESC
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
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_request public.upgrade_requests%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_existing public.payments%ROWTYPE;
    v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
    v_method TEXT := btrim(COALESCE(p_payment_method, ''));
    v_reference TEXT := NULLIF(btrim(COALESCE(p_transaction_reference, '')), '');
    v_paid NUMERIC(12,2);
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'SUPPORT_ACCESS_REQUIRED';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0
       OR v_currency !~ '^[A-Z]{3}$'
       OR char_length(v_method) NOT BETWEEN 2 AND 80
       OR v_reference IS NULL
       OR char_length(v_reference) > 200 THEN
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

    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:payment-ref:' || lower(v_reference), 0)
    );

    SELECT *
    INTO v_existing
    FROM public.payments payment
    WHERE lower(btrim(payment.transaction_reference)) = lower(v_reference)
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.order_id = v_order.id
           AND v_existing.status = 'confirmed'
           AND v_existing.amount = p_amount
           AND v_existing.currency = v_currency
           AND lower(btrim(v_existing.payment_method)) = lower(v_method) THEN
            SELECT COALESCE(sum(amount), 0)
            INTO v_paid
            FROM public.payments
            WHERE order_id = v_order.id
              AND status = 'confirmed';

            RETURN jsonb_build_object(
                'payment_id', v_existing.id,
                'paid_amount', v_paid,
                'agreed_price', v_order.agreed_price,
                'amount_due', GREATEST(v_order.agreed_price - v_paid, 0),
                'paid_enough', v_paid >= v_order.agreed_price,
                'idempotent', TRUE
            );
        END IF;
        RAISE EXCEPTION 'PAYMENT_REFERENCE_ALREADY_USED';
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
        v_reference,
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
            'payment_method', v_payment.payment_method,
            'transaction_reference', v_payment.transaction_reference
        )
    );

    RETURN jsonb_build_object(
        'payment_id', v_payment.id,
        'paid_amount', v_paid,
        'agreed_price', v_order.agreed_price,
        'amount_due', GREATEST(v_order.agreed_price - v_paid, 0),
        'paid_enough', v_paid >= v_order.agreed_price,
        'idempotent', FALSE
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_access(
    p_user_id UUID,
    p_role TEXT DEFAULT NULL,
    p_subscription_tier TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_before public.profiles%ROWTYPE;
    v_after public.profiles%ROWTYPE;
    v_role TEXT := CASE WHEN p_role IS NULL THEN NULL ELSE lower(btrim(p_role)) END;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    IF p_subscription_tier IS NOT NULL THEN
        RAISE EXCEPTION 'SUBSCRIPTION_TIER_IS_DERIVED';
    END IF;

    SELECT *
    INTO v_before
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND';
    END IF;

    IF v_role IS NOT NULL AND v_role NOT IN ('student', 'admin', 'support') THEN
        RAISE EXCEPTION 'INVALID_USER_ROLE';
    END IF;

    IF p_user_id = auth.uid()
       AND ((v_role IS NOT NULL AND v_role <> 'admin') OR p_is_active = FALSE) THEN
        RAISE EXCEPTION 'ADMIN_SELF_LOCKOUT';
    END IF;

    IF v_before.role = 'admin'
       AND v_before.is_active
       AND ((v_role IS NOT NULL AND v_role <> 'admin') OR p_is_active = FALSE)
       AND (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin' AND is_active = TRUE) <= 1 THEN
        RAISE EXCEPTION 'LAST_ADMIN_PROTECTED';
    END IF;

    UPDATE public.profiles
    SET role = COALESCE(v_role, role),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_user_id
    RETURNING * INTO v_after;

    IF v_before.role IS DISTINCT FROM v_after.role
       OR v_before.is_active IS DISTINCT FROM v_after.is_active THEN
        PERFORM private.business_audit(
            'user_access_profile_updated',
            'user',
            p_user_id::TEXT,
            jsonb_build_object(
                'before', jsonb_build_object(
                    'role', v_before.role,
                    'is_active', v_before.is_active
                ),
                'after', jsonb_build_object(
                    'role', v_after.role,
                    'is_active', v_after.is_active
                )
            )
        );
    END IF;

    RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_user_access(
    p_user_id UUID,
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL,
    p_starts_at TIMESTAMPTZ DEFAULT now(),
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:subscription:' || p_user_id::TEXT, 0)
    );

    IF EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        WHERE request_row.user_id = p_user_id
          AND request_row.status IN ('pending', 'contacted', 'paid')
    ) THEN
        RAISE EXCEPTION 'OPEN_UPGRADE_REQUEST_EXISTS';
    END IF;

    IF private.business_user_has_covering_grant(
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id
    ) THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
    END IF;

    SELECT *
    INTO v_grant
    FROM public.grant_user_access(
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id,
        p_starts_at,
        p_expires_at
    );

    PERFORM private.business_audit(
        'manual_access_granted',
        'user_access_grant',
        v_grant.id::TEXT,
        jsonb_build_object(
            'user_id', v_grant.user_id,
            'scope_type', v_grant.scope_type,
            'pathway_id', v_grant.pathway_id,
            'question_bank_id', v_grant.question_bank_id,
            'starts_at', v_grant.starts_at,
            'expires_at', v_grant.expires_at
        )
    );

    RETURN jsonb_build_object(
        'id', v_grant.id,
        'user_id', v_grant.user_id,
        'scope_type', v_grant.scope_type,
        'pathway_id', v_grant.pathway_id,
        'question_bank_id', v_grant.question_bank_id,
        'starts_at', v_grant.starts_at,
        'expires_at', v_grant.expires_at,
        'status', 'active'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_extend_user_access(
    p_grant_id BIGINT,
    p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
    v_old_expires TIMESTAMPTZ;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    SELECT *
    INTO v_grant
    FROM public.user_access_grants
    WHERE id = p_grant_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ACCESS_GRANT_NOT_FOUND';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:subscription:' || v_grant.user_id::TEXT, 0)
    );

    IF EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        WHERE request_row.user_id = v_grant.user_id
          AND request_row.status IN ('pending', 'contacted', 'paid')
    ) THEN
        RAISE EXCEPTION 'OPEN_UPGRADE_REQUEST_EXISTS';
    END IF;

    IF v_grant.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'REVOKED_ACCESS_CANNOT_BE_EXTENDED';
    END IF;
    IF v_grant.expires_at IS NULL THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_PERMANENT';
    END IF;
    IF p_expires_at IS NULL
       OR p_expires_at <= now()
       OR p_expires_at <= v_grant.starts_at
       OR p_expires_at <= v_grant.expires_at THEN
        RAISE EXCEPTION 'INVALID_ACCESS_EXTENSION';
    END IF;

    v_old_expires := v_grant.expires_at;

    UPDATE public.user_access_grants
    SET expires_at = p_expires_at
    WHERE id = p_grant_id
    RETURNING * INTO v_grant;

    PERFORM private.business_audit(
        'access_grant_extended',
        'user_access_grant',
        p_grant_id::TEXT,
        jsonb_build_object(
            'user_id', v_grant.user_id,
            'old_expires_at', v_old_expires,
            'new_expires_at', v_grant.expires_at
        )
    );

    RETURN jsonb_build_object(
        'id', v_grant.id,
        'expires_at', v_grant.expires_at,
        'status', CASE WHEN v_grant.expires_at > now() THEN 'active' ELSE 'expired' END
    );
END;
$$;

COMMENT ON COLUMN public.profiles.subscription_tier IS
'Legacy display-only summary. Never use for authorization. Premium entitlement is authoritative only in user_access_grants; admin RPCs cannot mutate this field.';

COMMIT;
