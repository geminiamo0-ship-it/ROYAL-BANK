BEGIN;

CREATE OR REPLACE FUNCTION private.catalog_pin_extension_target()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
BEGIN
    IF NEW.quote_snapshot IS NULL
       OR COALESCE(NEW.quote_snapshot->>'mode', '') <> 'extension'
       OR NULLIF(NEW.quote_snapshot->>'extension_grant_id', '') IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT grant_row.* INTO v_grant
    FROM public.user_access_grants grant_row
    WHERE grant_row.user_id = NEW.user_id
      AND grant_row.revoked_at IS NULL
      AND grant_row.starts_at <= now()
      AND grant_row.expires_at IS NOT NULL
      AND grant_row.expires_at > now()
      AND (
          (NEW.scope_type = 'global' AND grant_row.scope_type = 'global')
          OR (
              NEW.scope_type = 'pathway'
              AND grant_row.scope_type = 'pathway'
              AND grant_row.pathway_id = NEW.pathway_id
          )
          OR (
              NEW.scope_type = 'bank'
              AND grant_row.scope_type = 'bank'
              AND grant_row.question_bank_id = NEW.question_bank_id
          )
      )
    ORDER BY grant_row.expires_at DESC, grant_row.id DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXTENSION_TARGET_NOT_ACTIVE';
    END IF;

    NEW.quote_snapshot := NEW.quote_snapshot || jsonb_build_object(
        'extension_grant_id', v_grant.id,
        'access_expires_at_at_request', v_grant.expires_at
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER upgrade_requests_pin_catalog_extension
BEFORE INSERT OR UPDATE OF quote_snapshot ON public.upgrade_requests
FOR EACH ROW EXECUTE FUNCTION private.catalog_pin_extension_target();

COMMIT;
