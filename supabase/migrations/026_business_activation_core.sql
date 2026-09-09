-- Royal business activation core.
--
-- Finance, promotion attribution, and premium entitlement are deliberately
-- separated. public.user_access_grants remains the only premium authority.
-- Browser-facing writes go through SECURITY DEFINER RPCs with explicit role
-- checks; authenticated users get no direct DML privileges on these tables.

CREATE TABLE public.promo_codes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code TEXT NOT NULL,
    owner_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    discount_type TEXT NOT NULL DEFAULT 'none'
        CHECK (discount_type IN ('none', 'percentage', 'fixed', 'special_price')),
    discount_value NUMERIC(12,4),
    discount_currency TEXT,
    commission_type TEXT NOT NULL DEFAULT 'none'
        CHECK (commission_type IN ('none', 'percentage', 'fixed')),
    commission_value NUMERIC(12,4),
    commission_currency TEXT,
    commission_basis TEXT NOT NULL DEFAULT 'amount_paid'
        CHECK (commission_basis IN ('amount_paid', 'agreed_price')),
    valid_from TIMESTAMPTZ,
    valid_until TIMESTAMPTZ,
    max_activations INTEGER,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT promo_codes_code_format
        CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
    CONSTRAINT promo_codes_valid_window
        CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
    CONSTRAINT promo_codes_max_activations_check
        CHECK (max_activations IS NULL OR max_activations > 0),
    CONSTRAINT promo_codes_discount_value_check
        CHECK (
            (discount_type = 'none' AND discount_value IS NULL)
            OR (
                discount_type <> 'none'
                AND discount_value IS NOT NULL
                AND discount_value >= 0
                AND (discount_type <> 'percentage' OR discount_value <= 100)
            )
        ),
    CONSTRAINT promo_codes_discount_currency_check
        CHECK (
            (discount_type IN ('fixed', 'special_price')
                AND discount_currency IS NOT NULL
                AND discount_currency ~ '^[A-Z]{3}$')
            OR (
                discount_type NOT IN ('fixed', 'special_price')
                AND discount_currency IS NULL
            )
        ),
    CONSTRAINT promo_codes_commission_value_check
        CHECK (
            (commission_type = 'none' AND commission_value IS NULL)
            OR (
                commission_type <> 'none'
                AND commission_value IS NOT NULL
                AND commission_value >= 0
                AND (commission_type <> 'percentage' OR commission_value <= 100)
            )
        ),
    CONSTRAINT promo_codes_commission_currency_check
        CHECK (
            (commission_type = 'fixed'
                AND commission_currency IS NOT NULL
                AND commission_currency ~ '^[A-Z]{3}$')
            OR (
                commission_type <> 'fixed'
                AND commission_currency IS NULL
            )
        )
);

CREATE UNIQUE INDEX promo_codes_code_ci_uidx
    ON public.promo_codes (upper(code));

CREATE INDEX promo_codes_owner_idx
    ON public.promo_codes (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE TABLE public.upgrade_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_code TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL
        CHECK (scope_type IN ('global', 'pathway', 'bank')),
    pathway_id BIGINT REFERENCES public.pathways(id) ON DELETE RESTRICT,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE RESTRICT,
    promo_code_id BIGINT REFERENCES public.promo_codes(id) ON DELETE SET NULL,
    promo_code_entered TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'contacted', 'paid', 'activated', 'cancelled')),
    contacted_at TIMESTAMPTZ,
    contacted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ,
    activated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    cancel_reason TEXT,
    access_grant_id BIGINT UNIQUE
        REFERENCES public.user_access_grants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT upgrade_requests_public_code_format
        CHECK (public_code ~ '^RY-[A-F0-9]{8}$'),
    CONSTRAINT upgrade_requests_scope_shape
        CHECK (
            (scope_type = 'global' AND pathway_id IS NULL AND question_bank_id IS NULL)
            OR (scope_type = 'pathway' AND pathway_id IS NOT NULL AND question_bank_id IS NULL)
            OR (scope_type = 'bank' AND pathway_id IS NULL AND question_bank_id IS NOT NULL)
        ),
    CONSTRAINT upgrade_requests_cancel_shape
        CHECK (
            status <> 'cancelled'
            OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
        ),
    CONSTRAINT upgrade_requests_activation_shape
        CHECK (
            status <> 'activated'
            OR (activated_at IS NOT NULL AND access_grant_id IS NOT NULL)
        )
);

CREATE UNIQUE INDEX upgrade_requests_one_open_scope_uidx
    ON public.upgrade_requests (
        user_id,
        scope_type,
        COALESCE(pathway_id, 0),
        COALESCE(question_bank_id, 0)
    )
    WHERE status IN ('pending', 'contacted', 'paid');

CREATE INDEX upgrade_requests_support_queue_idx
    ON public.upgrade_requests (status, created_at DESC);

CREATE INDEX upgrade_requests_user_idx
    ON public.upgrade_requests (user_id, created_at DESC);

CREATE INDEX upgrade_requests_promo_idx
    ON public.upgrade_requests (promo_code_id, status)
    WHERE promo_code_id IS NOT NULL;

CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upgrade_request_id UUID NOT NULL UNIQUE
        REFERENCES public.upgrade_requests(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    scope_type TEXT NOT NULL
        CHECK (scope_type IN ('global', 'pathway', 'bank')),
    pathway_id BIGINT REFERENCES public.pathways(id) ON DELETE RESTRICT,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE RESTRICT,
    duration_months INTEGER,
    base_price NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    agreed_price NUMERIC(12,2) NOT NULL CHECK (agreed_price > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    promo_code_id BIGINT REFERENCES public.promo_codes(id) ON DELETE SET NULL,
    promo_rule_snapshot JSONB,
    internal_notes TEXT,
    status TEXT NOT NULL DEFAULT 'awaiting_payment'
        CHECK (status IN ('awaiting_payment', 'paid', 'activated', 'cancelled', 'refunded')),
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT orders_duration_check
        CHECK (duration_months IS NULL OR (duration_months >= 1 AND duration_months <= 120)),
    CONSTRAINT orders_scope_shape
        CHECK (
            (scope_type = 'global' AND pathway_id IS NULL AND question_bank_id IS NULL)
            OR (scope_type = 'pathway' AND pathway_id IS NOT NULL AND question_bank_id IS NULL)
            OR (scope_type = 'bank' AND pathway_id IS NULL AND question_bank_id IS NOT NULL)
        )
);

CREATE INDEX orders_user_idx
    ON public.orders (user_id, created_at DESC);

CREATE INDEX orders_status_idx
    ON public.orders (status, created_at DESC);

CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    payment_method TEXT NOT NULL CHECK (char_length(btrim(payment_method)) BETWEEN 2 AND 80),
    transaction_reference TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'void', 'refunded')),
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    verified_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

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
