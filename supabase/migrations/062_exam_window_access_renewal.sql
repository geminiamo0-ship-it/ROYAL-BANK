-- Lightweight renewal payload for the signed exam-window capability.
-- This avoids re-running the full bootstrap query solely to refresh the token.

CREATE OR REPLACE FUNCTION public.renew_exam_window_access(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_question_ids jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF COALESCE(v_session.is_completed, FALSE) THEN
        IF NOT public.can_read_locked_session(p_session_id) THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    ELSIF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(
        jsonb_agg(tsq.question_id ORDER BY tsq.sort_order),
        '[]'::jsonb
    )
    INTO v_question_ids
    FROM public.test_session_questions tsq
    WHERE tsq.test_session_id = p_session_id;

    RETURN jsonb_build_object(
        'session', jsonb_build_object(
            'id', v_session.id,
            'is_completed', COALESCE(v_session.is_completed, FALSE)
        ),
        'question_ids', v_question_ids
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_exam_window_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_exam_window_access(uuid) TO authenticated;
