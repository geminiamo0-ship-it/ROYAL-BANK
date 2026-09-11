-- Student shell profile lookup without a second remote Auth user lookup.
-- Middleware remains the authoritative protected-route authentication boundary;
-- this RPC binds the presentation data lookup to auth.uid() inside Postgres.

CREATE OR REPLACE FUNCTION public.get_my_student_shell_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN auth.uid() IS NULL THEN NULL
        ELSE (
            SELECT jsonb_build_object(
                'email', p.email,
                'full_name', p.full_name
            )
            FROM public.profiles p
            WHERE p.id = auth.uid()
            LIMIT 1
        )
    END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_student_shell_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_student_shell_profile() TO authenticated;
