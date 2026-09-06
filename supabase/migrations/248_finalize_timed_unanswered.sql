-- Finalize a timed block atomically.
-- Business rule:
--   * suspend/exit keeps unanswered questions suspended
--   * completing a timed block makes every unanswered locked question incorrect
--
-- A missing selected option is represented by selected_option_id = NULL only for
-- system-finalized timed unanswered rows. Interactive answer submission continues
-- to require a real option through submit_exam_answer().

CREATE OR REPLACE FUNCTION public.complete_exam_session(p_session_id UUID)
RETURNS public.test_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.test_sessions;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO result
    FROM public.test_sessions
    WHERE id = p_session_id
      AND user_id = auth.uid()
    FOR UPDATE;

    IF result.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF result.is_completed THEN
        RETURN result;
    END IF;

    IF result.session_type = 'timed' THEN
        INSERT INTO public.user_answers (
            test_session_id,
            user_id,
            question_id,
            selected_option_id,
            is_correct,
            is_flagged,
            time_spent_seconds
        )
        SELECT
            result.id,
            result.user_id,
            tsq.question_id,
            NULL,
            FALSE,
            FALSE,
            0
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = result.id
          AND NOT EXISTS (
              SELECT 1
              FROM public.user_answers ua
              WHERE ua.test_session_id = result.id
                AND ua.user_id = result.user_id
                AND ua.question_id = tsq.question_id
          );
    END IF;

    UPDATE public.test_sessions
    SET is_completed = TRUE
    WHERE id = result.id
      AND user_id = result.user_id
      AND is_completed = FALSE
    RETURNING * INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_exam_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_exam_session(UUID) TO authenticated;
