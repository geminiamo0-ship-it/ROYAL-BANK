SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

-- Hotfix: revoked/missing grants must never be interpreted as active pathway access.
-- Premium bank authorization is sourced only from user_access_grants for every role.

CREATE OR REPLACE FUNCTION public.has_premium_question_bank_access(p_bank_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND EXISTS (
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
        );
$function$;

CREATE OR REPLACE FUNCTION public.resolve_my_access(
    p_scope_type text,
    p_pathway_id bigint DEFAULT NULL::bigint,
    p_bank_id bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
    v_scope TEXT := lower(btrim(COALESCE(p_scope_type, '')));
    v_bank_pathway_id BIGINT;
    v_grant public.user_access_grants%ROWTYPE;
    v_total_banks INTEGER := 0;
    v_covered_banks INTEGER := 0;
    v_all_lifetime BOOLEAN := FALSE;
    v_effective_expiry TIMESTAMPTZ;
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

    -- Broader grants: global covers pathway/bank, pathway covers bank.
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
                'expires_soon', v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() + interval '30 days',
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

    -- Exact grant for the requested scope.
    SELECT grant_row.*
    INTO v_grant
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = v_user_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      AND (
          (v_scope = 'global' AND grant_row.scope_type = 'global')
          OR (v_scope = 'pathway' AND grant_row.scope_type = 'pathway' AND grant_row.pathway_id = p_pathway_id)
          OR (v_scope = 'bank' AND grant_row.scope_type = 'bank' AND grant_row.question_bank_id = p_bank_id)
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
            'expires_soon', v_grant.expires_at IS NOT NULL AND v_grant.expires_at <= now() + interval '30 days',
            'grant_id', v_grant.id,
            'scope_type', v_grant.scope_type,
            'pathway_id', v_grant.pathway_id,
            'question_bank_id', v_grant.question_bank_id,
            'starts_at', v_grant.starts_at,
            'expires_at', v_grant.expires_at,
            'is_lifetime', v_grant.expires_at IS NULL
        );
    END IF;

    -- A pathway can also be covered by active bank grants for every bank in it.
    -- Important: a LEFT JOIN row with no matching grant has NULL grant columns.
    -- `grant_row.expires_at IS NULL` alone would incorrectly classify that missing
    -- grant as lifetime access, so lifetime requires a real grant id.
    IF v_scope = 'pathway' THEN
        WITH bank_set AS (
            SELECT id
            FROM public.question_banks
            WHERE pathway_id = p_pathway_id
        ),
        bank_coverage AS (
            SELECT
                bank.id,
                bool_or(
                    grant_row.id IS NOT NULL
                    AND grant_row.expires_at IS NULL
                ) AS lifetime,
                max(grant_row.expires_at)
                    FILTER (WHERE grant_row.id IS NOT NULL AND grant_row.expires_at IS NOT NULL) AS finite_expiry
            FROM bank_set bank
            LEFT JOIN public.user_access_grants grant_row
              ON grant_row.user_id = v_user_id
             AND grant_row.scope_type = 'bank'
             AND grant_row.question_bank_id = bank.id
             AND grant_row.revoked_at IS NULL
             AND grant_row.starts_at <= now()
             AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
            GROUP BY bank.id
        )
        SELECT
            count(*)::INTEGER,
            count(*) FILTER (WHERE lifetime OR finite_expiry IS NOT NULL)::INTEGER,
            COALESCE(bool_and(lifetime), FALSE),
            min(CASE WHEN lifetime THEN 'infinity'::TIMESTAMPTZ ELSE finite_expiry END)
        INTO
            v_total_banks,
            v_covered_banks,
            v_all_lifetime,
            v_effective_expiry
        FROM bank_coverage;

        IF v_total_banks > 0 AND v_covered_banks = v_total_banks THEN
            RETURN jsonb_build_object(
                'has_access', TRUE,
                'coverage_kind', 'broader',
                'can_extend', FALSE,
                'expires_soon', NOT v_all_lifetime AND v_effective_expiry <= now() + interval '30 days',
                'grant_id', NULL,
                'scope_type', NULL,
                'pathway_id', p_pathway_id,
                'question_bank_id', NULL,
                'starts_at', NULL,
                'expires_at', CASE WHEN v_all_lifetime THEN NULL ELSE v_effective_expiry END,
                'is_lifetime', v_all_lifetime
            );
        END IF;
    END IF;

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
$function$;

-- Service-role-only import surface for the Royal Content Manager desktop app.
-- Questions absent from an incoming source are never deleted or unmapped.

CREATE OR REPLACE FUNCTION public.content_manager_import_questions(
    p_bank_id BIGINT,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_row JSONB;
    v_opt JSONB;
    v_qid BIGINT;
    v_option_count INTEGER := 0;
    v_question_count INTEGER := 0;
    v_correct_count INTEGER;
BEGIN
    IF p_bank_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.question_banks WHERE id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_BANK_NOT_FOUND';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_QUESTION_PAYLOAD';
    END IF;

    IF jsonb_array_length(p_rows) > 200 THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_QUESTION_BATCH_TOO_LARGE';
    END IF;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        v_qid := NULLIF(v_row->>'id', '')::BIGINT;

        IF v_qid IS NULL
           OR COALESCE(btrim(v_row->>'text_html'), '') = ''
           OR COALESCE(btrim(v_row->>'explanation_html'), '') = ''
           OR COALESCE(btrim(v_row->>'category'), '') = '' THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_QUESTION';
        END IF;

        IF jsonb_typeof(COALESCE(v_row->'options', '[]'::jsonb)) <> 'array'
           OR jsonb_array_length(COALESCE(v_row->'options', '[]'::jsonb)) < 2 THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_OPTIONS_FOR_QUESTION_%', v_qid;
        END IF;

        SELECT COUNT(*)
        INTO v_correct_count
        FROM jsonb_array_elements(v_row->'options') option_row
        WHERE COALESCE((option_row->>'is_correct')::BOOLEAN, FALSE);

        IF v_correct_count <> 1 THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_CORRECT_OPTION_COUNT_%_%', v_qid, v_correct_count;
        END IF;

        INSERT INTO public.questions (
            id, main_id, text_html, explanation_html, category, topic, concept,
            concept_id, notes_id, difficulty, source, pm_question_id, concepts_json
        )
        VALUES (
            v_qid,
            NULLIF(v_row->>'main_id', '')::BIGINT,
            v_row->>'text_html',
            v_row->>'explanation_html',
            v_row->>'category',
            NULLIF(v_row->>'topic', ''),
            NULLIF(v_row->>'concept', ''),
            NULLIF(v_row->>'concept_id', ''),
            NULLIF(v_row->>'notes_id', ''),
            COALESCE(NULLIF(v_row->>'difficulty', ''), '1'),
            COALESCE(NULLIF(v_row->>'source', ''), 'PassMedicine'),
            NULLIF(v_row->>'pm_question_id', ''),
            NULLIF(v_row->>'concepts_json', '')
        )
        ON CONFLICT (id) DO UPDATE
        SET
            main_id = EXCLUDED.main_id,
            text_html = EXCLUDED.text_html,
            explanation_html = EXCLUDED.explanation_html,
            category = EXCLUDED.category,
            topic = EXCLUDED.topic,
            concept = EXCLUDED.concept,
            concept_id = EXCLUDED.concept_id,
            notes_id = EXCLUDED.notes_id,
            difficulty = EXCLUDED.difficulty,
            source = EXCLUDED.source,
            pm_question_id = EXCLUDED.pm_question_id,
            concepts_json = EXCLUDED.concepts_json;

        INSERT INTO public.question_bank_questions (question_bank_id, question_id)
        VALUES (p_bank_id, v_qid)
        ON CONFLICT (question_bank_id, question_id) DO NOTHING;

        -- Clear correctness first so the one-correct-option partial unique index
        -- cannot be violated while an answer key changes.
        UPDATE public.options
        SET is_correct = FALSE
        WHERE question_id = v_qid;

        FOR v_opt IN SELECT value FROM jsonb_array_elements(v_row->'options')
        LOOP
            IF NULLIF(v_opt->>'option_order', '') IS NULL
               OR COALESCE(btrim(v_opt->>'text_html'), '') = '' THEN
                RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_OPTION_FOR_QUESTION_%', v_qid;
            END IF;

            INSERT INTO public.options (
                question_id, text_html, is_correct, option_order, percentage
            )
            VALUES (
                v_qid,
                v_opt->>'text_html',
                COALESCE((v_opt->>'is_correct')::BOOLEAN, FALSE),
                (v_opt->>'option_order')::INTEGER,
                NULLIF(v_opt->>'percentage', '')::REAL
            )
            ON CONFLICT (question_id, option_order) DO UPDATE
            SET
                text_html = EXCLUDED.text_html,
                is_correct = EXCLUDED.is_correct,
                percentage = EXCLUDED.percentage;

            v_option_count := v_option_count + 1;
        END LOOP;

        -- Source options replace the current option set for this supplied question.
        BEGIN
            DELETE FROM public.options existing_option
            WHERE existing_option.question_id = v_qid
              AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(v_row->'options') source_option
                  WHERE (source_option->>'option_order')::INTEGER = existing_option.option_order
              );
        EXCEPTION
            WHEN foreign_key_violation THEN
                RAISE EXCEPTION 'CONTENT_MANAGER_STALE_OPTION_REFERENCED_%', v_qid;
        END;

        v_question_count := v_question_count + 1;
    END LOOP;

    -- Questions are imported with canonical external IDs. Keep the sequence above
    -- the largest explicit ID for any future generated inserts.
    PERFORM setval(
        pg_get_serial_sequence('public.questions', 'id'),
        GREATEST(
            (SELECT last_value FROM public.questions_id_seq),
            (SELECT COALESCE(MAX(id), 1) FROM public.questions)
        ),
        TRUE
    );

    RETURN jsonb_build_object(
        'bank_id', p_bank_id,
        'questions_processed', v_question_count,
        'options_processed', v_option_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.content_manager_import_articles(
    p_bank_id BIGINT,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_row JSONB;
    v_article_count INTEGER := 0;
BEGIN
    IF p_bank_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.question_banks WHERE id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_BANK_NOT_FOUND';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_ARTICLE_PAYLOAD';
    END IF;

    IF jsonb_array_length(p_rows) > 500 THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_ARTICLE_BATCH_TOO_LARGE';
    END IF;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        IF COALESCE(btrim(v_row->>'id'), '') = ''
           OR COALESCE(btrim(v_row->>'name'), '') = ''
           OR COALESCE(btrim(v_row->>'content_html'), '') = '' THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_ARTICLE';
        END IF;

        INSERT INTO public.library_articles (id, name, category, content_html, source)
        VALUES (
            v_row->>'id',
            v_row->>'name',
            NULLIF(v_row->>'category', ''),
            v_row->>'content_html',
            COALESCE(NULLIF(v_row->>'source', ''), 'Pastest')
        )
        ON CONFLICT (id) DO UPDATE
        SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            content_html = EXCLUDED.content_html,
            source = EXCLUDED.source;

        INSERT INTO public.question_bank_library_articles (
            question_bank_id, article_id, display_order
        )
        VALUES (
            p_bank_id,
            v_row->>'id',
            COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0)
        )
        ON CONFLICT (question_bank_id, article_id) DO UPDATE
        SET display_order = EXCLUDED.display_order;

        v_article_count := v_article_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'bank_id', p_bank_id,
        'articles_processed', v_article_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.content_manager_refresh_counts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW public.question_bank_topic_counts;
    RETURN jsonb_build_object('refreshed', TRUE, 'refreshed_at', clock_timestamp());
END;
$$;

REVOKE ALL ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.content_manager_import_articles(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.content_manager_refresh_counts() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION public.content_manager_import_articles(BIGINT, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION public.content_manager_refresh_counts() TO service_role;
