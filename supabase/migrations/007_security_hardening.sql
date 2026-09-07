-- Security hardening for authorization-sensitive tables and functions.
-- This migration intentionally preserves the current product UI and data model.

-- Users may update their own non-privileged profile fields, but must never be able
-- to self-promote role/subscription/is_active through the public profiles table.
DROP POLICY IF EXISTS "Users can update own profile (restricted) or admin full update" ON public.profiles;

CREATE POLICY "Admins can update profiles"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- SECURITY DEFINER functions must not trust a caller-controlled search_path.
ALTER FUNCTION public.is_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_support_or_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_ip_blocked(INET) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_category_analytics(UUID) SET search_path = public, pg_temp;

-- Analytics is user-scoped. Prevent an authenticated caller from requesting
-- another student's analytics by supplying an arbitrary UUID.
REVOKE ALL ON FUNCTION public.get_user_category_analytics(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_category_analytics(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_category_analytics(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_category_analytics(p_user_id UUID)
RETURNS TABLE (
    category TEXT,
    total_answered BIGINT,
    correct_count BIGINT,
    accuracy_percentage NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF auth.uid() <> p_user_id AND NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    SELECT
        q.category,
        COUNT(ua.id) AS total_answered,
        COUNT(CASE WHEN ua.is_correct THEN 1 END) AS correct_count,
        ROUND(
            COUNT(CASE WHEN ua.is_correct THEN 1 END)::NUMERIC
            / NULLIF(COUNT(ua.id), 0) * 100,
            1
        ) AS accuracy_percentage
    FROM public.user_answers ua
    JOIN public.questions q ON ua.question_id = q.id
    WHERE ua.user_id = p_user_id
    GROUP BY q.category
    ORDER BY total_answered DESC;
END;
$$;
