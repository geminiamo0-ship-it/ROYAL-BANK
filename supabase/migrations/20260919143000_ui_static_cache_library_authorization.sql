-- Split library authorization/disclosure from static article delivery.
-- The HTML can be cached privately in R2 while entitlement and trial quota
-- remain authoritative in Postgres on every open.

CREATE OR REPLACE FUNCTION public.authorize_library_article_read(
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

    RETURN jsonb_build_object(
        'article_id', p_article_id,
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

CREATE OR REPLACE FUNCTION public.get_library_article_content_authorized(
    p_bank_id BIGINT,
    p_article_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_article public.library_articles%ROWTYPE;
    v_has_premium BOOLEAN;
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

    v_has_premium := public.has_premium_question_bank_access(p_bank_id);

    IF NOT v_has_premium AND NOT EXISTS (
        SELECT 1
        FROM private.library_article_disclosures disclosure
        WHERE disclosure.user_id = auth.uid()
          AND disclosure.question_bank_id = p_bank_id
          AND disclosure.article_id = p_article_id
    ) THEN
        -- Deliberately stricter than can_access_library_article(): an undisclosed
        -- trial article must pass authorize_library_article_read first so opening
        -- cached/fallback content can never bypass the unique-article quota.
        RAISE EXCEPTION 'LIBRARY_ACCESS_DENIED';
    END IF;

    SELECT *
    INTO v_article
    FROM public.library_articles article
    WHERE article.id = p_article_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'LIBRARY_ARTICLE_NOT_FOUND';
    END IF;

    RETURN jsonb_build_object(
        'id', v_article.id,
        'name', v_article.name,
        'category', v_article.category,
        'content_html', v_article.content_html
    );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_library_article_read(BIGINT, TEXT)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_library_article_content_authorized(BIGINT, TEXT)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.authorize_library_article_read(BIGINT, TEXT)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_library_article_content_authorized(BIGINT, TEXT)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.authorize_library_article_read(BIGINT, TEXT) IS
    'Authoritative library entitlement + trial disclosure boundary without returning static article HTML.';
COMMENT ON FUNCTION public.get_library_article_content_authorized(BIGINT, TEXT) IS
    'Fallback content reader. Trial content is readable only after prior disclosure; cannot consume or bypass quota.';
