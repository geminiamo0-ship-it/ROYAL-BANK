-- Authoritative timing metadata for refresh/resume.
-- Timed/fixed_timed sessions use a fixed deadline from started_at; Suspend does
-- not pause the clock. Standard/Tutor question timing remains a client-side
-- per-question accumulator persisted with each answer.

CREATE OR REPLACE FUNCTION private.augment_exam_bootstrap_timing(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session_id uuid;
    v_session public.test_sessions;
    v_deadline timestamptz;
    v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    BEGIN
        v_session_id := NULLIF(v_payload->'session'->>'id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        v_session_id := NULL;
    END;

    IF v_session_id IS NULL THEN
        RETURN v_payload;
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = v_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.session_type IN ('timed', 'fixed_timed')
       AND COALESCE(v_session.time_limit_minutes, 0) > 0 THEN
        v_deadline := v_session.started_at
            + make_interval(mins => v_session.time_limit_minutes);
    ELSE
        v_deadline := NULL;
    END IF;

    v_payload := jsonb_set(
        v_payload,
        '{session,started_at}',
        COALESCE(to_jsonb(v_session.started_at), 'null'::jsonb),
        true
    );
    v_payload := jsonb_set(
        v_payload,
        '{session,deadline_at}',
        COALESCE(to_jsonb(v_deadline), 'null'::jsonb),
        true
    );
    v_payload := jsonb_set(v_payload, '{server_now}', to_jsonb(clock_timestamp()), true);

    RETURN v_payload;
END;
$function$;

REVOKE ALL ON FUNCTION private.augment_exam_bootstrap_timing(jsonb)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_exam_session_bootstrap_idempotent_v2(
    p_request_id uuid,
    p_bank_id bigint,
    p_session_type text,
    p_limit integer,
    p_difficulties text[] DEFAULT ARRAY[]::text[],
    p_categories text[] DEFAULT ARRAY[]::text[],
    p_topics jsonb DEFAULT '[]'::jsonb,
    p_question_selection text DEFAULT 'new_only'::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    SELECT private.augment_exam_bootstrap_timing(
        public.create_exam_session_bootstrap_idempotent(
            p_request_id,
            p_bank_id,
            p_session_type,
            p_limit,
            p_difficulties,
            p_categories,
            p_topics,
            p_question_selection
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_v2(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    SELECT private.augment_exam_bootstrap_timing(
        public.get_exam_session_bootstrap(p_session_id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_ref_v2(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    SELECT private.augment_exam_bootstrap_timing(
        public.get_exam_session_bootstrap_ref(p_session_id)
    );
$function$;

REVOKE ALL ON FUNCTION public.create_exam_session_bootstrap_idempotent_v2(uuid, bigint, text, integer, text[], text[], jsonb, text)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_v2(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_ref_v2(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_exam_session_bootstrap_idempotent_v2(uuid, bigint, text, integer, text[], text[], jsonb, text)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_ref_v2(uuid) TO authenticated;