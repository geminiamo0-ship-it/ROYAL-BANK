-- Return the persisted answer and immediately-revealable feedback in one database round trip.
-- Intended for Standard/Tutor submissions. Timed modes remain protected by
-- get_exam_question_feedback(), which refuses to reveal feedback before End Block.

CREATE OR REPLACE FUNCTION public.submit_exam_answer_with_feedback(
    p_session_id UUID,
    p_question_id BIGINT,
    p_selected_option_id BIGINT,
    p_time_spent_seconds INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    answer_payload JSONB;
    feedback_payload JSONB;
BEGIN
    answer_payload := public.submit_exam_answer(
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );

    feedback_payload := public.get_exam_question_feedback(
        p_session_id,
        p_question_id
    );

    RETURN jsonb_build_object(
        'answer', answer_payload,
        'feedback', feedback_payload
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam_answer_with_feedback(UUID, BIGINT, BIGINT, INTEGER)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback(UUID, BIGINT, BIGINT, INTEGER)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback(UUID, BIGINT, BIGINT, INTEGER)
TO service_role;

COMMENT ON FUNCTION public.submit_exam_answer_with_feedback(UUID, BIGINT, BIGINT, INTEGER) IS
    'Persists a Standard/Tutor answer and returns answer + authorized feedback in one RPC. Existing feedback reveal rules remain authoritative.';
