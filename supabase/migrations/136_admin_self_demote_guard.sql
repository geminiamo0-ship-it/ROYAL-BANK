CREATE OR REPLACE FUNCTION public.admin_update_user_access(
    p_user_id UUID,
    p_role TEXT DEFAULT NULL,
    p_subscription_tier TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    updated_profile public.profiles;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    IF p_role IS NOT NULL AND p_role NOT IN ('student', 'admin', 'support') THEN
        RAISE EXCEPTION 'Invalid role';
    END IF;

    IF p_subscription_tier IS NOT NULL
       AND p_subscription_tier NOT IN ('free_trial', 'premium_individual', 'premium_full') THEN
        RAISE EXCEPTION 'Invalid subscription tier';
    END IF;

    IF p_user_id = auth.uid() AND (p_role IS NOT NULL AND p_role <> 'admin' OR p_is_active = FALSE) THEN
        RAISE EXCEPTION 'Admin cannot demote or deactivate the current account';
    END IF;

    UPDATE public.profiles
    SET
        role = COALESCE(p_role, role),
        subscription_tier = COALESCE(p_subscription_tier, subscription_tier),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_user_id
    RETURNING * INTO updated_profile;

    IF updated_profile.id IS NULL THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    RETURN updated_profile;
END;
$$;
