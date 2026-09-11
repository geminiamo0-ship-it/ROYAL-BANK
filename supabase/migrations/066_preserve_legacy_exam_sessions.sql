-- Rollout compatibility for sessions created before content release pinning.
--
-- Only a new session Create may choose/pin an immutable content release. Resume and
-- review reads must never retrofit an existing NULL content_release_id to whichever
-- release happens to be active at read time: that would make an old session appear
-- consistent while silently changing the content generation it originally used.

CREATE OR REPLACE FUNCTION private.augment_exam_bootstrap_existing_release(
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session_id uuid;
    v_release_id text;
BEGIN
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RETURN p_payload;
    END IF;

    v_session_id := NULLIF(p_payload->'session'->>'id', '')::uuid;
    IF v_session_id IS NULL THEN
        RETURN p_payload;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT ts.content_release_id
    INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = v_session_id
      AND ts.user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    RETURN jsonb_set(
        p_payload,
        '{session,content_release_id}',
        COALESCE(to_jsonb(v_release_id), 'null'::jsonb),
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.augment_exam_bootstrap_existing_release(jsonb)
    FROM PUBLIC, anon, authenticated;

-- Keep the two-argument signatures for a safe rolling app/database deploy. The
-- requested release argument is intentionally ignored on reads; it exists only for
-- compatibility with an app revision that may still send it during rollout.
CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_v3(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    RETURN private.augment_exam_bootstrap_existing_release(
        public.get_exam_session_bootstrap_v2(p_session_id)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_ref_v3(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    -- The ref bootstrap records the initial/resumed disclosure window and therefore
    -- remains VOLATILE even though release lookup itself is read-only.
    RETURN private.augment_exam_bootstrap_existing_release(
        public.get_exam_session_bootstrap_ref_v2(p_session_id)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    RETURN private.augment_exam_bootstrap_existing_release(
        public.get_completed_exam_review_bootstrap_ref(p_session_id)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_ref_v3(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_ref_v3(uuid, text)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(uuid, text)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text) IS
    'Resume bootstrap: reports an existing content release but never pins a legacy session.';
COMMENT ON FUNCTION public.get_exam_session_bootstrap_ref_v3(uuid, text) IS
    'R2 resume bootstrap refs: reports an existing content release but never pins a legacy session.';
COMMENT ON FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(uuid, text) IS
    'R2 review bootstrap refs: reports an existing content release but never pins a legacy session.';