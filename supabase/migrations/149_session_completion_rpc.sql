CREATE OR REPLACE FUNCTION public.complete_exam_session(p_session_id UUID)
RETURNS public.test_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.test_sessions;
    answered_count BIGINT;
    correct_count BIGINT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = p_session_id
          AND ts.user_id = auth.uid()
          AND ts.is_completed = FALSE
    ) THEN
        RAISE EXCEPTION 'Active session not found';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE ua.is_correct)
    INTO answered_count, correct_count
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid();

    UPDATE public.test_sessions
    SET
        is_completed = TRUE,
        completed_at = timezone('utc'::text, now()),
        score_percentage = CASE
            WHEN answered_count = 0 THEN 0
            ELSE ROUND((correct_count::NUMERIC / answered_count::NUMERIC * 100), 2)::REAL
        END
    WHERE id = p_session_id
      AND user_id = auth.uid()
    RETURNING * INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_exam_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_exam_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_exam_session(UUID) TO authenticated;
