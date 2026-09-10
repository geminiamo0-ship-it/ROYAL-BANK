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
