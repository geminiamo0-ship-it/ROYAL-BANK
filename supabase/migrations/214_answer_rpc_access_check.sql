CREATE OR REPLACE FUNCTION public.submit_exam_answer(
    p_session_id UUID,
    p_question_id BIGINT,
    p_selected_option_id BIGINT,
    p_time_spent_seconds INT DEFAULT 0
)
RETURNS public.user_answers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    mode TEXT;
    completed BOOLEAN;
    bank_id BIGINT;
    result public.user_answers;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_time_spent_seconds < 0 THEN
        RAISE EXCEPTION 'time_spent_seconds cannot be negative';
    END IF;

    SELECT ts.session_type, ts.is_completed, ts.question_bank_id
    INTO mode, completed, bank_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF NOT FOUND OR completed THEN
        RAISE EXCEPTION 'Active session not found';
    END IF;

    IF NOT public.can_access_question_bank(bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF mode IN ('standard', 'tutor') THEN
        INSERT INTO public.user_answers (
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        RETURNING * INTO result;
    ELSE
        INSERT INTO public.user_answers (
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        ON CONFLICT (test_session_id, question_id)
        DO UPDATE SET
            selected_option_id = EXCLUDED.selected_option_id,
            time_spent_seconds = EXCLUDED.time_spent_seconds
        RETURNING * INTO result;
    END IF;

    RETURN result;
END;
$$;
