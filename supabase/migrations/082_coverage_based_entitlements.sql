BEGIN;

-- Royal entitlements are coverage-based, not one-subscription-per-user.
-- Customers may hold multiple independent bank/pathway grants, while exact or
-- broader coverage prevents redundant purchases. Payment/activation hardening
-- from 079-081 remains intact.

DROP INDEX IF EXISTS public.upgrade_requests_one_open_user_uidx;

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
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_scope TEXT := lower(btrim(COALESCE(p_scope_type, '')));
    v_bank_pathway_id BIGINT;
BEGIN
    IF v_scope = 'bank' THEN
        SELECT pathway_id
        INTO v_bank_pathway_id
        FROM public.question_banks
        WHERE id = p_bank_id;

        IF NOT FOUND THEN
            RETURN FALSE;
        END IF;
    END IF;

    IF v_scope = 'global' THEN
        RETURN EXISTS (
            SELECT 1
            FROM public.user_access_grants grant_row
            WHERE grant_row.user_id = p_user_id
              AND grant_row.scope_type = 'global'
              AND grant_row.revoked_at IS NULL
              AND grant_row.starts_at <= now()
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
        );
    END IF;

    IF v_scope = 'bank' THEN
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
                      grant_row.scope_type = 'pathway'
                      AND grant_row.pathway_id = v_bank_pathway_id
                  )
                  OR (
                      grant_row.scope_type = 'bank'
                      AND grant_row.question_bank_id = p_bank_id
                  )
              )
        );
    END IF;

    IF v_scope = 'pathway' THEN
        IF EXISTS (
            SELECT 1
            FROM public.user_access_grants grant_row
            WHERE grant_row.user_id = p_user_id
              AND grant_row.revoked_at IS NULL
              AND grant_row.starts_at <= now()
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
              AND (
                  grant_row.scope_type = 'global'
                  OR (
                      grant_row.scope_type = 'pathway'
                      AND grant_row.pathway_id = p_pathway_id
                  )
              )
        ) THEN
            RETURN TRUE;
        END IF;

        -- Owning every current bank activates the current pathway coverage.
        RETURN EXISTS (
            SELECT 1
            FROM public.question_banks bank
            WHERE bank.pathway_id = p_pathway_id
        )
        AND NOT EXISTS (
            SELECT 1
            FROM public.question_banks bank
            WHERE bank.pathway_id = p_pathway_id
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.user_access_grants grant_row
                  WHERE grant_row.user_id = p_user_id
                    AND grant_row.scope_type = 'bank'
                    AND grant_row.question_bank_id = bank.id
                    AND grant_row.revoked_at IS NULL
                    AND grant_row.starts_at <= now()
                    AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
              )
        );
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION private.business_user_has_covering_grant(uuid, text, bigint, bigint)
FROM PUBLIC, anon, authenticated;

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
    v_total_banks INTEGER := 0;
    v_covered_banks INTEGER := 0;
    v_aggregate_starts TIMESTAMPTZ;
    v_aggregate_expires TIMESTAMPTZ;
    v_aggregate_lifetime BOOLEAN := FALSE;
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

    -- A real broader grant takes precedence when it covers this scope.
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
                'coverage_source', grant_row.scope_type,
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

    -- Exact direct ownership remains extendable when finite.
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
            'coverage_source', 'exact',
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

    -- If every current bank is directly owned, treat the pathway as activated.
    -- The effective pathway expiry is the earliest end of the best active
    -- coverage for each bank. If every bank has lifetime access, it is lifetime.
    IF v_scope = 'pathway' THEN
        WITH bank_coverage AS (
            SELECT
                bank.id AS bank_id,
                min(grant_row.starts_at) AS starts_at,
                bool_or(grant_row.expires_at IS NULL) AS has_lifetime,
                max(grant_row.expires_at) FILTER (WHERE grant_row.expires_at IS NOT NULL) AS max_expires_at
            FROM public.question_banks bank
            JOIN public.user_access_grants grant_row
              ON grant_row.user_id = v_user_id
             AND grant_row.scope_type = 'bank'
             AND grant_row.question_bank_id = bank.id
             AND grant_row.revoked_at IS NULL
             AND grant_row.starts_at <= now()
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
            WHERE bank.pathway_id = p_pathway_id
            GROUP BY bank.id
        ), summary AS (
            SELECT
                (SELECT count(*)::INTEGER FROM public.question_banks WHERE pathway_id = p_pathway_id) AS total_banks,
                count(*)::INTEGER AS covered_banks,
                max(starts_at) AS effective_starts,
                COALESCE(bool_and(has_lifetime), FALSE) AS all_lifetime,
                min(
                    CASE
                        WHEN has_lifetime THEN 'infinity'::TIMESTAMPTZ
                        ELSE max_expires_at
                    END
                ) AS effective_expires
            FROM bank_coverage
        )
        SELECT
            total_banks,
            covered_banks,
            effective_starts,
            all_lifetime,
            CASE WHEN all_lifetime THEN NULL ELSE effective_expires END
        INTO
            v_total_banks,
            v_covered_banks,
            v_aggregate_starts,
            v_aggregate_lifetime,
            v_aggregate_expires
        FROM summary;

        IF v_total_banks > 0 AND v_covered_banks = v_total_banks THEN
            RETURN jsonb_build_object(
                'has_access', TRUE,
                'coverage_kind', 'broader',
                'coverage_source', 'all_banks',
                'can_extend', FALSE,
                'expires_soon', NOT v_aggregate_lifetime
                    AND v_aggregate_expires IS NOT NULL
                    AND v_aggregate_expires <= now() + interval '30 days',
                'grant_id', NULL,
                'scope_type', 'pathway',
                'pathway_id', p_pathway_id,
                'question_bank_id', NULL,
                'starts_at', v_aggregate_starts,
                'expires_at', v_aggregate_expires,
                'is_lifetime', v_aggregate_lifetime
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'has_access', FALSE,
        'coverage_kind', 'none',
        'coverage_source', 'none',
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

CREATE OR REPLACE FUNCTION public.grant_user_access(
    p_user_id UUID,
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL,
    p_starts_at TIMESTAMPTZ DEFAULT now(),
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.user_access_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.user_access_grants;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF p_scope_type NOT IN ('global', 'pathway', 'bank') THEN
        RAISE EXCEPTION 'Invalid access scope';
    END IF;

    IF p_starts_at IS NULL THEN
        RAISE EXCEPTION 'starts_at is required';
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= p_starts_at THEN
        RAISE EXCEPTION 'expires_at must be after starts_at';
    END IF;

    IF p_scope_type = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Global access cannot specify a pathway or bank';
        END IF;
    ELSIF p_scope_type = 'pathway' THEN
        IF p_pathway_id IS NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pathway access requires pathway_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'Pathway not found';
        END IF;
    ELSE
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL THEN
            RAISE EXCEPTION 'Bank access requires bank_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
            RAISE EXCEPTION 'Question bank not found';
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('royal:entitlement:' || p_user_id::TEXT, 0)
    );

    -- Current exact/broader coverage is never duplicated.
    IF private.business_user_has_covering_grant(
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id
    ) THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
    END IF;

    -- Also prevent duplicate scheduled/active rows for the exact same product.
    IF EXISTS (
        SELECT 1
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = p_user_id
          AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
          AND (
              (p_scope_type = 'global' AND grant_row.scope_type = 'global')
              OR (
                  p_scope_type = 'pathway'
                  AND grant_row.scope_type = 'pathway'
                  AND grant_row.pathway_id = p_pathway_id
              )
              OR (
                  p_scope_type = 'bank'
                  AND grant_row.scope_type = 'bank'
                  AND grant_row.question_bank_id = p_bank_id
              )
          )
    ) THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
    END IF;

    INSERT INTO public.user_access_grants (
        user_id,
        scope_type,
        pathway_id,
        question_bank_id,
        starts_at,
        expires_at,
        granted_by
    ) VALUES (
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id,
        p_starts_at,
        p_expires_at,
        auth.uid()
    )
    RETURNING * INTO result;

    RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_user_access(
    uuid, text, bigint, bigint, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_access(
    uuid, text, bigint, bigint, timestamptz, timestamptz
) TO service_role;

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

    -- Serialize only this product for this user. Independent products may be
    -- requested separately without creating duplicate requests for one product.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'royal:catalog-request:' || v_user_id::TEXT || ':' || v_product_id::TEXT,
            0
        )
    );

    v_access := public.resolve_my_access(v_product_type, v_pathway_id, v_bank_id);

    IF COALESCE((v_access->>'has_access')::BOOLEAN, FALSE) THEN
        IF v_access->>'coverage_kind' = 'exact'
           AND COALESCE((v_access->>'can_extend')::BOOLEAN, FALSE) THEN
            v_mode := 'extension';
        ELSIF v_access->>'coverage_kind' = 'exact'
           AND COALESCE((v_access->>'is_lifetime')::BOOLEAN, FALSE) THEN
            RAISE EXCEPTION 'ACCESS_ALREADY_LIFETIME';
        ELSE
            RAISE EXCEPTION 'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT';
        END IF;
    ELSE
        v_mode := 'upgrade';
    END IF;

    SELECT request_row.*
    INTO v_existing
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

REVOKE EXECUTE ON FUNCTION public.create_catalog_upgrade_request(bigint, text, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_catalog_upgrade_request(bigint, text, uuid)
TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_catalog_upgrade_request_hardened_impl(bigint, text, uuid);

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

    SELECT *
    INTO v_product
    FROM public.catalog_products product
    WHERE product.status = 'active'
      AND (
          (v_scope = 'global' AND p_target_id IS NULL AND product.product_type = 'global')
          OR (v_scope = 'pathway' AND product.product_type = 'pathway' AND product.pathway_id = p_target_id)
          OR (v_scope = 'bank' AND product.product_type = 'bank' AND product.question_bank_id = p_target_id)
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
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

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
        -- Backwards-compatible fields for already deployed UI code. They no
        -- longer represent a user-global commerce lock.
        'commerce_locked', FALSE,
        'commerce_lock_reason', NULL,
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
        hashtextextended('royal:entitlement:' || p_user_id::TEXT, 0)
    );

    IF EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        WHERE request_row.user_id = p_user_id
          AND request_row.status IN ('pending', 'contacted', 'paid')
          AND request_row.scope_type = p_scope_type
          AND request_row.pathway_id IS NOT DISTINCT FROM p_pathway_id
          AND request_row.question_bank_id IS NOT DISTINCT FROM p_bank_id
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
        hashtextextended('royal:entitlement:' || v_grant.user_id::TEXT, 0)
    );

    IF EXISTS (
        SELECT 1
        FROM public.upgrade_requests request_row
        WHERE request_row.user_id = v_grant.user_id
          AND request_row.status IN ('pending', 'contacted', 'paid')
          AND request_row.scope_type = v_grant.scope_type
          AND request_row.pathway_id IS NOT DISTINCT FROM v_grant.pathway_id
          AND request_row.question_bank_id IS NOT DISTINCT FROM v_grant.question_bank_id
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

COMMENT ON TABLE public.user_access_grants IS
'Authoritative premium entitlement ledger. Multiple independent bank/pathway grants are allowed. Exact or broader active coverage prevents redundant grants; all active banks in a pathway synthesize current pathway activation.';

COMMIT;
