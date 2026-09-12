BEGIN;

-- The commercial invariant belongs at the only application grant-creation
-- primitive, not on every raw ledger INSERT. This keeps trusted DBA/migration
-- maintenance possible while every Admin/Support application grant still
-- serializes and enforces one live/scheduled subscription per user.
DROP TRIGGER IF EXISTS user_access_grants_one_subscription
ON public.user_access_grants;

DROP FUNCTION IF EXISTS private.enforce_single_subscription_window();

CREATE OR REPLACE FUNCTION public.grant_user_access(
    p_user_id UUID,
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL,
    p_starts_at TIMESTAMPTZ DEFAULT now(),
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.user_access_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.user_access_grants;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF p_scope_type NOT IN ('global', 'pathway', 'bank') THEN
        RAISE EXCEPTION 'Invalid access scope';
    END IF;

    IF p_starts_at IS NULL THEN
        RAISE EXCEPTION 'starts_at is required';
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= p_starts_at THEN
        RAISE EXCEPTION 'expires_at must be after starts_at';
    END IF;

    IF p_scope_type = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Global access cannot specify a pathway or bank';
        END IF;
    ELSIF p_scope_type = 'pathway' THEN
        IF p_pathway_id IS NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pathway access requires pathway_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'Pathway not found';
        END IF;
    ELSE
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL THEN
            RAISE EXCEPTION 'Bank access requires bank_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
            RAISE EXCEPTION 'Question bank not found';
        END IF;
    END IF;

    -- Historical already-expired rows may still be written by trusted callers,
    -- but a live or scheduled entitlement must be the only one for the user.
    IF p_expires_at IS NULL OR p_expires_at > now() THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended('royal:subscription:' || p_user_id::TEXT, 0)
        );

        IF EXISTS (
            SELECT 1
            FROM public.user_access_grants grant_row
            WHERE grant_row.user_id = p_user_id
              AND grant_row.revoked_at IS NULL
              AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
        ) THEN
            RAISE EXCEPTION 'ACTIVE_SUBSCRIPTION_EXISTS';
        END IF;
    END IF;

    INSERT INTO public.user_access_grants (
        user_id,
        scope_type,
        pathway_id,
        question_bank_id,
        starts_at,
        expires_at,
        granted_by
    ) VALUES (
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id,
        p_starts_at,
        p_expires_at,
        auth.uid()
    )
    RETURNING * INTO result;

    RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_user_access(
    uuid, text, bigint, bigint, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.grant_user_access(
    uuid, text, bigint, bigint, timestamptz, timestamptz
) TO service_role;

COMMIT;
