-- Royal access model: one premium entitlement source + bank-scoped libraries.
--
-- Premium access is authoritative only in public.user_access_grants.
-- A bank entitlement covers both the question bank and its mapped library.
-- Trial users may open a limited number of unique articles per bank.

ALTER TABLE public.question_banks
    ADD COLUMN IF NOT EXISTS free_trial_article_limit INTEGER NOT NULL DEFAULT 10;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'question_banks_free_trial_article_limit_check'
          AND conrelid = 'public.question_banks'::regclass
    ) THEN
        ALTER TABLE public.question_banks
            ADD CONSTRAINT question_banks_free_trial_article_limit_check
            CHECK (free_trial_article_limit >= 0);
    END IF;
END;
$$;

COMMENT ON COLUMN public.question_banks.free_trial_article_limit IS
    'Lifetime count of unique library articles a non-premium user may disclose for this trial bank. Ignored when the bank is not trial-enabled.';

CREATE TABLE IF NOT EXISTS public.question_bank_library_articles (
    question_bank_id BIGINT NOT NULL
        REFERENCES public.question_banks(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL
        REFERENCES public.library_articles(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (question_bank_id, article_id)
);

COMMENT ON TABLE public.question_bank_library_articles IS
    'Maps library articles to the question bank whose entitlement controls access. One article may be mapped to multiple banks.';

ALTER TABLE public.question_bank_library_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage bank library mappings"
    ON public.question_bank_library_articles;
CREATE POLICY "Admins manage bank library mappings"
    ON public.question_bank_library_articles
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_question_bank_library_articles_article
    ON public.question_bank_library_articles(article_id, question_bank_id);

CREATE TABLE IF NOT EXISTS private.library_article_disclosures (
    user_id UUID NOT NULL
        REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_bank_id BIGINT NOT NULL
        REFERENCES public.question_banks(id) ON DELETE CASCADE,
    article_id TEXT NOT NULL
        REFERENCES public.library_articles(id) ON DELETE CASCADE,
    first_disclosed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, question_bank_id, article_id)
);

COMMENT ON TABLE private.library_article_disclosures IS
    'Immutable per-user unique article disclosure ledger used to enforce bank library free-trial quotas.';

CREATE INDEX IF NOT EXISTS idx_library_article_disclosures_user_bank
    ON private.library_article_disclosures(user_id, question_bank_id, first_disclosed_at);

-- Existing MRCP Part 1 library content belongs to the current MRCP Part 1 main bank.
-- Use stable product identifiers rather than generated numeric ids.
INSERT INTO public.question_bank_library_articles(question_bank_id, article_id)
SELECT qb.id, la.id
FROM public.question_banks qb
JOIN public.pathways p ON p.id = qb.pathway_id
CROSS JOIN public.library_articles la
WHERE p.slug = 'mrcp-part-1'
  AND qb.name = 'MRCP Part 1 Main Bank'
ON CONFLICT (question_bank_id, article_id) DO NOTHING;

-- user_access_grants is now the only premium entitlement source.
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

-- Refuse to destroy unexpected legacy entitlement data. The current production
-- table is empty; if a future environment has rows they must be migrated first.
DO $$
BEGIN
    IF to_regclass('public.user_pathway_access') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.user_pathway_access) THEN
        RAISE EXCEPTION 'LEGACY_USER_PATHWAY_ACCESS_NOT_EMPTY';
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.grant_user_pathway_access(
    UUID, BIGINT, TEXT, INTEGER, TIMESTAMPTZ
);
DROP TABLE IF EXISTS public.user_pathway_access;

-- Direct student reads of article bodies are no longer allowed. Content must go
-- through the disclosure-aware RPC below. Existing admin policy remains intact.
DROP POLICY IF EXISTS "Active users can read library articles"
    ON public.library_articles;

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
