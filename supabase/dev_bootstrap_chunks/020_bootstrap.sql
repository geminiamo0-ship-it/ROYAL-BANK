CREATE OR REPLACE FUNCTION public.can_access_library_article(
    p_bank_id BIGINT,
    p_article_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_trial_enabled BOOLEAN;
    v_trial_limit INTEGER;
    v_used INTEGER;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RETURN FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_library_articles mapping
        WHERE mapping.question_bank_id = p_bank_id
          AND mapping.article_id = p_article_id
    ) THEN
        RETURN FALSE;
    END IF;

    IF public.has_premium_question_bank_access(p_bank_id) THEN
        RETURN TRUE;
    END IF;

    SELECT qb.is_free_trial, qb.free_trial_article_limit
    INTO v_trial_enabled, v_trial_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    IF NOT FOUND OR NOT v_trial_enabled THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM private.library_article_disclosures disclosure
        WHERE disclosure.user_id = auth.uid()
          AND disclosure.question_bank_id = p_bank_id
          AND disclosure.article_id = p_article_id
    ) THEN
        RETURN TRUE;
    END IF;

    SELECT count(*)::INTEGER
    INTO v_used
    FROM private.library_article_disclosures disclosure
    WHERE disclosure.user_id = auth.uid()
      AND disclosure.question_bank_id = p_bank_id;

    RETURN v_used < v_trial_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_library_articles(p_bank_id BIGINT)
RETURNS TABLE (
    article_id TEXT,
    article_name TEXT,
    category TEXT,
    is_disclosed BOOLEAN,
    premium_access BOOLEAN,
    trial_limit INTEGER,
    trial_remaining INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_trial_enabled BOOLEAN;
    v_trial_limit INTEGER;
    v_has_premium BOOLEAN;
    v_used INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    SELECT qb.is_free_trial, qb.free_trial_article_limit
    INTO v_trial_enabled, v_trial_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUESTION_BANK_NOT_FOUND';
    END IF;

    v_has_premium := public.has_premium_question_bank_access(p_bank_id);

    IF NOT v_has_premium AND NOT v_trial_enabled THEN
        RAISE EXCEPTION 'LIBRARY_ACCESS_DENIED';
    END IF;

    IF NOT v_has_premium THEN
        SELECT count(*)::INTEGER
        INTO v_used
        FROM private.library_article_disclosures disclosure
        WHERE disclosure.user_id = auth.uid()
          AND disclosure.question_bank_id = p_bank_id;
    END IF;

    RETURN QUERY
    SELECT
        la.id,
        la.name,
        la.category,
        EXISTS (
            SELECT 1
            FROM private.library_article_disclosures disclosure
            WHERE disclosure.user_id = auth.uid()
              AND disclosure.question_bank_id = p_bank_id
              AND disclosure.article_id = la.id
        ),
        v_has_premium,
        CASE WHEN v_has_premium THEN NULL ELSE v_trial_limit END,
        CASE
            WHEN v_has_premium THEN NULL
            ELSE GREATEST(v_trial_limit - v_used, 0)
        END
    FROM public.question_bank_library_articles mapping
    JOIN public.library_articles la ON la.id = mapping.article_id
    WHERE mapping.question_bank_id = p_bank_id
    ORDER BY mapping.display_order, la.category, la.name, la.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_library_article(
    p_bank_id BIGINT,
    p_article_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_article public.library_articles%ROWTYPE;
    v_trial_enabled BOOLEAN;
    v_trial_limit INTEGER;
    v_has_premium BOOLEAN;
    v_already_disclosed BOOLEAN := FALSE;
    v_used INTEGER := 0;
    v_first_disclosure BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_library_articles mapping
        WHERE mapping.question_bank_id = p_bank_id
          AND mapping.article_id = p_article_id
    ) THEN
        RAISE EXCEPTION 'LIBRARY_ARTICLE_NOT_FOUND';
    END IF;

    SELECT qb.is_free_trial, qb.free_trial_article_limit
    INTO v_trial_enabled, v_trial_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUESTION_BANK_NOT_FOUND';
    END IF;

    v_has_premium := public.has_premium_question_bank_access(p_bank_id);

    IF NOT v_has_premium THEN
        IF NOT v_trial_enabled THEN
            RAISE EXCEPTION 'LIBRARY_ACCESS_DENIED';
        END IF;

        -- Serialize first-time trial disclosures per user+bank so parallel opens
        -- cannot exceed the unique-article quota.
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                'royal:library-trial:' || auth.uid()::TEXT || ':' || p_bank_id::TEXT,
                0
            )
        );

        SELECT EXISTS (
            SELECT 1
            FROM private.library_article_disclosures disclosure
            WHERE disclosure.user_id = auth.uid()
              AND disclosure.question_bank_id = p_bank_id
              AND disclosure.article_id = p_article_id
        )
        INTO v_already_disclosed;

        SELECT count(*)::INTEGER
        INTO v_used
        FROM private.library_article_disclosures disclosure
        WHERE disclosure.user_id = auth.uid()
          AND disclosure.question_bank_id = p_bank_id;

        IF NOT v_already_disclosed THEN
            IF v_used >= v_trial_limit THEN
                RAISE EXCEPTION 'LIBRARY_TRIAL_LIMIT';
            END IF;

            INSERT INTO private.library_article_disclosures(
                user_id,
                question_bank_id,
                article_id
            ) VALUES (
                auth.uid(),
                p_bank_id,
                p_article_id
            );

            v_used := v_used + 1;
            v_first_disclosure := TRUE;
        END IF;
    END IF;

    SELECT *
    INTO v_article
    FROM public.library_articles la
    WHERE la.id = p_article_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LIBRARY_ARTICLE_NOT_FOUND';
    END IF;

    RETURN jsonb_build_object(
        'article', jsonb_build_object(
            'id', v_article.id,
            'name', v_article.name,
            'category', v_article.category,
            'content_html', v_article.content_html
        ),
        'access', jsonb_build_object(
            'premium', v_has_premium,
            'trial', NOT v_has_premium,
            'first_disclosure', v_first_disclosure,
            'trial_limit', CASE WHEN v_has_premium THEN NULL ELSE v_trial_limit END,
            'trial_used', CASE WHEN v_has_premium THEN NULL ELSE v_used END,
            'trial_remaining', CASE
                WHEN v_has_premium THEN NULL
                ELSE GREATEST(v_trial_limit - v_used, 0)
            END
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_library_article(BIGINT, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.list_library_articles(BIGINT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_library_article(BIGINT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.list_library_articles(BIGINT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.list_library_articles(BIGINT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.list_library_articles(BIGINT) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.can_access_library_article(BIGINT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.list_library_articles(BIGINT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_library_article(BIGINT, TEXT) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_library_article_disclosures_bank_user
    ON private.library_article_disclosures(question_bank_id, user_id);

CREATE INDEX IF NOT EXISTS idx_library_article_disclosures_article
    ON private.library_article_disclosures(article_id);

DROP FUNCTION IF EXISTS public.audit_pathway_access_change();

DROP TABLE IF EXISTS public.pathway_access_audit;

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
