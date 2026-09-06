CREATE OR REPLACE FUNCTION public.set_login_history_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.login_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_login_history_time_trigger ON public.login_history;
CREATE TRIGGER set_login_history_time_trigger
    BEFORE INSERT ON public.login_history
    FOR EACH ROW EXECUTE FUNCTION public.set_login_history_time();

REVOKE ALL ON FUNCTION public.set_login_history_time() FROM PUBLIC;
