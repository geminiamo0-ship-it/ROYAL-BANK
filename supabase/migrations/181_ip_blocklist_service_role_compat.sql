CREATE OR REPLACE FUNCTION public.set_ip_block_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Admin access required';
        END IF;
        NEW.blocked_by := auth.uid();
    END IF;
    NEW.blocked_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;
