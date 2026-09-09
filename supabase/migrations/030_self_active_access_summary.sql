-- Safe self-service view of active premium grants for subscription UI.
-- The function exposes only the signed-in user's entitlement scope and dates.

CREATE OR REPLACE FUNCTION public.get_my_active_access_grants()
RETURNS TABLE (
    id BIGINT,
    scope_type TEXT,
    pathway_id BIGINT,
    question_bank_id BIGINT,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    RETURN QUERY
    SELECT
        grant_row.id,
        grant_row.scope_type,
        grant_row.pathway_id,
        grant_row.question_bank_id,
        grant_row.starts_at,
        grant_row.expires_at,
        grant_row.created_at
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = auth.uid()
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ORDER BY grant_row.created_at DESC, grant_row.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_access_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_active_access_grants() TO authenticated;

COMMENT ON FUNCTION public.get_my_active_access_grants() IS
    'Returns only the signed-in active user current premium grant scopes and dates for subscription-status UI.';
