-- The Content Manager importer is callable only by service_role, but PostgREST
-- sessions preload pg-safeupdate via the authenticator role. The importer uses a
-- deliberately bounded DELETE to replace stale option rows for a supplied
-- question. Disable pg-safeupdate only while this function executes so that
-- bounded server-side delete can run; the function's own WHERE conditions and
-- service-role-only EXECUTE grant remain the safety boundary.

ALTER FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
SET safeupdate.enabled = 'off';

REVOKE ALL ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
TO service_role;

COMMENT ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
IS 'Service-role-only Royal Content Manager import. pg-safeupdate is disabled only for this function so its bounded stale-option DELETE can execute. Missing source questions remain untouched.';
