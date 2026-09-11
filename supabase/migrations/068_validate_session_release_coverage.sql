-- A newly-created session may only pin a release that contains every locked
-- question. Content ingestion can race with release activation; without this guard a
-- live-only question could be selected and the session would then be permanently
-- unable to hydrate that question from its immutable R2 generation.
--
-- The pin happens in the same transaction as idempotent Create, so a mismatch raises
-- and rolls back the session, locked questions, quota/security side effects, and the
-- create idempotency row together.

CREATE OR REPLACE FUNCTION private.pin_exam_session_content_release(
    p_session_id uuid,
    p_requested_release_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_missing_question_id bigint;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.content_release_id IS NOT NULL THEN
        RETURN v_session.content_release_id;
    END IF;
    IF p_requested_release_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM private.assert_release_id(p_requested_release_id);
    IF NOT EXISTS (
        SELECT 1
        FROM private.exam_content_releases r
        WHERE r.release_id = p_requested_release_id
          AND r.is_ready = true
    ) THEN
        RAISE EXCEPTION 'CONTENT_RELEASE_NOT_READY';
    END IF;

    SELECT tsq.question_id
    INTO v_missing_question_id
    FROM public.test_session_questions tsq
    LEFT JOIN private.exam_content_release_answers snapshot
      ON snapshot.release_id = p_requested_release_id
     AND snapshot.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND snapshot.question_id IS NULL
    ORDER BY tsq.sort_order
    LIMIT 1;

    IF v_missing_question_id IS NOT NULL THEN
        RAISE EXCEPTION 'CONTENT_RELEASE_SESSION_MISMATCH';
    END IF;

    UPDATE public.test_sessions
    SET content_release_id = p_requested_release_id
    WHERE id = p_session_id
      AND user_id = auth.uid()
      AND content_release_id IS NULL
    RETURNING * INTO v_session;

    IF v_session.id IS NULL THEN
        SELECT * INTO v_session
        FROM public.test_sessions ts
        WHERE ts.id = p_session_id
          AND ts.user_id = auth.uid();
    END IF;

    RETURN v_session.content_release_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.pin_exam_session_content_release(uuid, text)
    FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.pin_exam_session_content_release(uuid, text) IS
    'Pins Create to one ready release only when every locked session question is covered by that immutable release snapshot.';