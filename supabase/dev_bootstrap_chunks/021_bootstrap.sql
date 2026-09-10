CREATE INDEX payments_order_status_idx
    ON public.payments (order_id, status, paid_at);

CREATE TABLE public.commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
    promo_code_id BIGINT NOT NULL REFERENCES public.promo_codes(id) ON DELETE RESTRICT,
    partner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    basis_amount NUMERIC(12,2) NOT NULL CHECK (basis_amount >= 0),
    commission_type TEXT NOT NULL CHECK (commission_type IN ('percentage', 'fixed')),
    commission_value NUMERIC(12,4) NOT NULL CHECK (commission_value >= 0),
    commission_amount NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('pending', 'approved', 'paid', 'reversed')),
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    reversed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX commissions_partner_status_idx
    ON public.commissions (partner_user_id, status, created_at DESC);

CREATE TABLE public.admin_audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_role TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX admin_audit_logs_entity_idx
    ON public.admin_audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX admin_audit_logs_actor_idx
    ON public.admin_audit_logs (actor_user_id, created_at DESC)
    WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.upgrade_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.promo_codes FROM anon, authenticated;

REVOKE ALL ON TABLE public.upgrade_requests FROM anon, authenticated;

REVOKE ALL ON TABLE public.orders FROM anon, authenticated;

REVOKE ALL ON TABLE public.payments FROM anon, authenticated;

REVOKE ALL ON TABLE public.commissions FROM anon, authenticated;

REVOKE ALL ON TABLE public.admin_audit_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.business_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'private', 'pg_temp'
AS $$
BEGIN
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

CREATE TRIGGER promo_codes_touch_updated_at
BEFORE UPDATE ON public.promo_codes
FOR EACH ROW EXECUTE FUNCTION private.business_touch_updated_at();

CREATE TRIGGER upgrade_requests_touch_updated_at
BEFORE UPDATE ON public.upgrade_requests
FOR EACH ROW EXECUTE FUNCTION private.business_touch_updated_at();

CREATE TRIGGER orders_touch_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION private.business_touch_updated_at();

CREATE OR REPLACE FUNCTION private.business_actor_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
    SELECT role
    FROM public.profiles
    WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.business_audit(
    p_action TEXT,
    p_entity_type TEXT,
    p_entity_id TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    INSERT INTO public.admin_audit_logs (
        actor_user_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        auth.uid(),
        private.business_actor_role(),
        p_action,
        p_entity_type,
        p_entity_id,
        COALESCE(p_metadata, '{}'::jsonb)
    );
END;
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

CREATE OR REPLACE FUNCTION private.business_product_name(
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
    SELECT CASE
        WHEN p_scope_type = 'global' THEN 'Royal Global Access'
        WHEN p_scope_type = 'pathway' THEN (
            SELECT name FROM public.pathways WHERE id = p_pathway_id
        )
        WHEN p_scope_type = 'bank' THEN (
            SELECT name FROM public.question_banks WHERE id = p_bank_id
        )
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.create_upgrade_request(
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL,
    p_promo_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_scope_type TEXT := lower(btrim(COALESCE(p_scope_type, '')));
    v_promo_code TEXT := NULLIF(upper(btrim(COALESCE(p_promo_code, ''))), '');
    v_promo public.promo_codes%ROWTYPE;
    v_existing public.upgrade_requests%ROWTYPE;
    v_request public.upgrade_requests%ROWTYPE;
    v_public_code TEXT;
    v_product_name TEXT;
    v_attempt INTEGER;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    IF v_scope_type NOT IN ('global', 'pathway', 'bank') THEN
        RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
    END IF;

    IF v_scope_type = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSIF v_scope_type = 'pathway' THEN
        IF p_pathway_id IS NULL OR p_bank_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    ELSE
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
            RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
        END IF;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'royal:upgrade:' || v_user_id::TEXT || ':' || v_scope_type || ':' ||
            COALESCE(p_pathway_id::TEXT, '-') || ':' || COALESCE(p_bank_id::TEXT, '-'),
            0
        )
    );

    IF private.business_user_has_covering_grant(
        v_user_id, v_scope_type, p_pathway_id, p_bank_id
    ) THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
    END IF;

    SELECT *
    INTO v_existing
    FROM public.upgrade_requests request_row
    WHERE request_row.user_id = v_user_id
      AND request_row.scope_type = v_scope_type
      AND request_row.pathway_id IS NOT DISTINCT FROM p_pathway_id
      AND request_row.question_bank_id IS NOT DISTINCT FROM p_bank_id
      AND request_row.status IN ('pending', 'contacted', 'paid')
    ORDER BY request_row.created_at DESC
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'request_id', v_existing.id,
            'public_code', v_existing.public_code,
            'status', v_existing.status,
            'scope_type', v_existing.scope_type,
            'product_name', private.business_product_name(
                v_existing.scope_type,
                v_existing.pathway_id,
                v_existing.question_bank_id
            ),
            'promo_applied', v_existing.promo_code_id IS NOT NULL
        );
    END IF;

    IF v_promo_code IS NOT NULL THEN
        SELECT *
        INTO v_promo
        FROM public.promo_codes promo
        WHERE upper(promo.code) = v_promo_code
          AND promo.status = 'active'
          AND (promo.valid_from IS NULL OR promo.valid_from <= now())
          AND (promo.valid_until IS NULL OR promo.valid_until > now());

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PROMO_CODE_INVALID';
        END IF;

        IF v_promo.max_activations IS NOT NULL
           AND (
               SELECT count(*)
               FROM public.upgrade_requests activated_request
               WHERE activated_request.promo_code_id = v_promo.id
                 AND activated_request.status = 'activated'
           ) >= v_promo.max_activations THEN
            RAISE EXCEPTION 'PROMO_CODE_LIMIT_REACHED';
        END IF;
    END IF;

    v_product_name := private.business_product_name(
        v_scope_type, p_pathway_id, p_bank_id
    );

    IF v_product_name IS NULL THEN
        RAISE EXCEPTION 'INVALID_UPGRADE_SCOPE';
    END IF;

    FOR v_attempt IN 1..12 LOOP
        v_public_code := 'RY-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8));
        EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM public.upgrade_requests
            WHERE public_code = v_public_code
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
        promo_code_entered
    ) VALUES (
        v_public_code,
        v_user_id,
        v_scope_type,
        p_pathway_id,
        p_bank_id,
        CASE WHEN v_promo_code IS NULL THEN NULL ELSE v_promo.id END,
        CASE WHEN v_promo_code IS NULL THEN NULL ELSE v_promo.code END
    )
    RETURNING * INTO v_request;

    RETURN jsonb_build_object(
        'request_id', v_request.id,
        'public_code', v_request.public_code,
        'status', v_request.status,
        'scope_type', v_request.scope_type,
        'product_name', v_product_name,
        'promo_applied', v_request.promo_code_id IS NOT NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.support_list_upgrade_requests(
    p_status TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
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
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
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
        private.business_product_name(
            request_row.scope_type,
            request_row.pathway_id,
            request_row.question_bank_id
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
