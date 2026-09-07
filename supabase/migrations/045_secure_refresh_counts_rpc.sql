CREATE OR REPLACE FUNCTION public.refresh_question_bank_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    REFRESH MATERIALIZED VIEW CONCURRENTLY public.question_bank_topic_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_question_bank_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_question_bank_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_question_bank_counts() TO authenticated;
