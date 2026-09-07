-- Keep the PostgREST pre-request hook callable by the impersonated API roles while
-- removing it from the exposed `public` RPC surface. PostgREST accepts a
-- schema-qualified db-pre-request function and invokes it after role switching.
--
-- This is intentionally a schema move of the already-tested function rather than a
-- rewrite, so gateway validation behavior and transaction-local proof semantics stay
-- byte-for-byte the same.

CREATE SCHEMA IF NOT EXISTS api_hooks;

REVOKE ALL ON SCHEMA api_hooks FROM PUBLIC;
GRANT USAGE ON SCHEMA api_hooks TO anon, authenticated, service_role, authenticator;

ALTER FUNCTION public.royal_exam_pre_request()
    SET SCHEMA api_hooks;

REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request()
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_hooks.royal_exam_pre_request()
    TO anon, authenticated, service_role, authenticator;

ALTER ROLE authenticator
    SET pgrst.db_pre_request = 'api_hooks.royal_exam_pre_request';

NOTIFY pgrst, 'reload config';
