-- Preserve the legacy error text contract used by the existing security regression
-- suite while keeping the Release C audit and lockout protections.

CREATE OR REPLACE FUNCTION public.admin_update_user_access(
    p_user_id UUID,
    p_role TEXT DEFAULT NULL,
    p_subscription_tier TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_before public.profiles%ROWTYPE;
    v_after public.profiles%ROWTYPE;
    v_role TEXT := CASE WHEN p_role IS NULL THEN NULL ELSE lower(btrim(p_role)) END;
    v_tier TEXT := CASE WHEN p_subscription_tier IS NULL THEN NULL ELSE lower(btrim(p_subscription_tier)) END;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    SELECT * INTO v_before
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND';
    END IF;

    IF v_role IS NOT NULL AND v_role NOT IN ('student', 'admin', 'support') THEN
        RAISE EXCEPTION 'INVALID_USER_ROLE';
    END IF;

    IF v_tier IS NOT NULL AND v_tier NOT IN ('free_trial', 'premium_individual', 'premium_full') THEN
        RAISE EXCEPTION 'INVALID_SUBSCRIPTION_TIER';
    END IF;

    IF p_user_id = auth.uid()
       AND ((v_role IS NOT NULL AND v_role <> 'admin') OR p_is_active = FALSE) THEN
        RAISE EXCEPTION 'ADMIN_SELF_LOCKOUT';
    END IF;

    IF v_before.role = 'admin'
       AND v_before.is_active
       AND ((v_role IS NOT NULL AND v_role <> 'admin') OR p_is_active = FALSE)
       AND (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin' AND is_active = TRUE) <= 1 THEN
        RAISE EXCEPTION 'LAST_ADMIN_PROTECTED';
    END IF;

    UPDATE public.profiles
    SET
        role = COALESCE(v_role, role),
        subscription_tier = COALESCE(v_tier, subscription_tier),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_user_id
    RETURNING * INTO v_after;

    IF v_before.role IS DISTINCT FROM v_after.role
       OR v_before.subscription_tier IS DISTINCT FROM v_after.subscription_tier
       OR v_before.is_active IS DISTINCT FROM v_after.is_active THEN
        PERFORM private.business_audit(
            'user_access_profile_updated',
            'user',
            p_user_id::TEXT,
            jsonb_build_object(
                'before', jsonb_build_object(
                    'role', v_before.role,
                    'subscription_tier', v_before.subscription_tier,
                    'is_active', v_before.is_active
                ),
                'after', jsonb_build_object(
                    'role', v_after.role,
                    'subscription_tier', v_after.subscription_tier,
                    'is_active', v_after.is_active
                )
            )
        );
    END IF;

    RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;
