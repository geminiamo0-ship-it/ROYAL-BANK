CREATE OR REPLACE FUNCTION public.set_ip_block_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;
    NEW.blocked_by := auth.uid();
    NEW.blocked_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_ip_block_actor_trigger ON public.ip_blocklist;
CREATE TRIGGER set_ip_block_actor_trigger
    BEFORE INSERT OR UPDATE ON public.ip_blocklist
    FOR EACH ROW EXECUTE FUNCTION public.set_ip_block_actor();

REVOKE ALL ON FUNCTION public.set_ip_block_actor() FROM PUBLIC;
