CREATE OR REPLACE FUNCTION public.complete_exam_session(p_session_id UUID)
RETURNS public.test_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.test_sessions;
    total_count BIGINT;
    correct_count BIGINT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT COUNT(*)
    INTO total_count
    FROM public.test_session_questions tsq
    JOIN public.test_sessions ts ON ts.id = tsq.test_session_id
    WHERE tsq.test_session_id = p_session_id
      AND ts.user_id = auth.uid()
      AND ts.is_completed = FALSE;

    IF total_count = 0 OR total_count > 70 THEN
        RAISE EXCEPTION 'Active session not found or invalid locked question count';
    END IF;

    SELECT COUNT(*) FILTER (WHERE ua.is_correct)
    INTO correct_count
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid();

    UPDATE public.test_sessions
    SET
        total_questions = total_count::INT,
        is_completed = TRUE,
        completed_at = timezone('utc'::text, now()),
        score_percentage = ROUND((correct_count::NUMERIC / total_count::NUMERIC * 100), 2)::REAL
    WHERE id = p_session_id
      AND user_id = auth.uid()
      AND is_completed = FALSE
    RETURNING * INTO result;

    RETURN result;
END;
$$;
