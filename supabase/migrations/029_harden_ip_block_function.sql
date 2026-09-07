-- Blocklist membership is privileged security information.

CREATE OR REPLACE FUNCTION public.is_ip_blocked(client_ip INET)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.ip_blocklist
        WHERE ip_address = client_ip
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_ip_blocked(INET) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_ip_blocked(INET) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_ip_blocked(INET) TO authenticated;
