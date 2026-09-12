BEGIN;

-- Follow-up to 082: PL/pgSQL permits unresolved dotted names at function
-- creation time, so pin the broader coverage source to the selected row value.
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
                'coverage_source', v_grant.scope_type,
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

COMMIT;
