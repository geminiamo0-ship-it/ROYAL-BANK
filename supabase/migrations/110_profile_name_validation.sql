CREATE OR REPLACE FUNCTION public.update_my_profile(
    p_full_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    updated_profile public.profiles;
    clean_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    clean_name := CASE WHEN p_full_name IS NULL THEN NULL ELSE btrim(p_full_name) END;

    IF clean_name IS NOT NULL AND (char_length(clean_name) < 1 OR char_length(clean_name) > 120) THEN
        RAISE EXCEPTION 'Full name must be between 1 and 120 characters';
    END IF;

    UPDATE public.profiles
    SET
        full_name = COALESCE(clean_name, full_name),
        avatar_url = COALESCE(p_avatar_url, avatar_url),
        updated_at = timezone('utc'::text, now())
    WHERE id = auth.uid()
    RETURNING * INTO updated_profile;

    RETURN updated_profile;
END;
$$;
