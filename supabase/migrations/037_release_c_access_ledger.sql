-- Release C centralized access-management read surface.

CREATE OR REPLACE FUNCTION public.admin_list_access_grants(
    p_search TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id BIGINT,
    user_id UUID,
    full_name TEXT,
    email TEXT,
    scope_type TEXT,
    scope_name TEXT,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    status TEXT,
    granted_by UUID,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revoke_reason TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_search TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_status TEXT := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_search IS NOT NULL AND char_length(v_search) > 200 THEN
        RAISE EXCEPTION 'INVALID_ACCESS_SEARCH';
    END IF;

    IF v_status IS NOT NULL AND v_status NOT IN ('active', 'upcoming', 'expired', 'revoked') THEN
        RAISE EXCEPTION 'INVALID_ACCESS_STATUS';
    END IF;

    RETURN QUERY
    WITH grant_rows AS (
        SELECT
            grant_row.id,
            grant_row.user_id,
            profile.full_name,
            profile.email,
            grant_row.scope_type,
            CASE
                WHEN grant_row.scope_type = 'global' THEN 'All Royal access'
                WHEN grant_row.scope_type = 'pathway' THEN COALESCE(pathway.name, 'Pathway #' || grant_row.pathway_id::TEXT)
                ELSE COALESCE(bank.name, 'Question bank #' || grant_row.question_bank_id::TEXT)
            END AS scope_name,
            grant_row.starts_at,
            grant_row.expires_at,
            CASE
                WHEN grant_row.revoked_at IS NOT NULL THEN 'revoked'
                WHEN grant_row.starts_at > now() THEN 'upcoming'
                WHEN grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now() THEN 'expired'
                ELSE 'active'
            END AS status,
            grant_row.granted_by,
            grant_row.revoked_at,
            grant_row.revoked_by,
            grant_row.revoke_reason,
            grant_row.created_at
        FROM public.user_access_grants grant_row
        JOIN public.profiles profile ON profile.id = grant_row.user_id
        LEFT JOIN public.pathways pathway ON pathway.id = grant_row.pathway_id
        LEFT JOIN public.question_banks bank ON bank.id = grant_row.question_bank_id
        WHERE v_search IS NULL
           OR profile.email ILIKE '%' || v_search || '%'
           OR COALESCE(profile.full_name, '') ILIKE '%' || v_search || '%'
           OR profile.id::TEXT = v_search
           OR grant_row.id::TEXT = v_search
    )
    SELECT
        grant_rows.id,
        grant_rows.user_id,
        grant_rows.full_name,
        grant_rows.email,
        grant_rows.scope_type,
        grant_rows.scope_name,
        grant_rows.starts_at,
        grant_rows.expires_at,
        grant_rows.status,
        grant_rows.granted_by,
        grant_rows.revoked_at,
        grant_rows.revoked_by,
        grant_rows.revoke_reason,
        grant_rows.created_at
    FROM grant_rows
    WHERE v_status IS NULL OR grant_rows.status = v_status
    ORDER BY grant_rows.created_at DESC, grant_rows.id DESC
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_access_grants(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_access_grants(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
