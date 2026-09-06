-- Canonical per-question state for a user/bank. Suspended is an unanswered locked
-- question in an unfinished session; New excludes both finalized answers and
-- suspended locks. Flagged is independent/persistent.

CREATE OR REPLACE FUNCTION public.get_user_question_states(p_bank_id BIGINT)
RETURNS TABLE (
    question_id BIGINT,
    answer_state TEXT,
    is_suspended BOOLEAN,
    is_flagged BOOLEAN,
    is_new BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    WITH bank_questions AS (
        SELECT qbq.question_id
        FROM public.question_bank_questions qbq
        WHERE qbq.question_bank_id = p_bank_id
    ),
    latest AS (
        SELECT DISTINCT ON (ua.question_id)
            ua.question_id,
            ua.is_correct
        FROM public.user_answers ua
        WHERE ua.user_id = auth.uid()
        ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
    ),
    suspended AS (
        SELECT DISTINCT tsq.question_id
        FROM public.test_session_questions tsq
        JOIN public.test_sessions ts ON ts.id = tsq.test_session_id
        LEFT JOIN public.user_answers ua
          ON ua.test_session_id = ts.id
         AND ua.question_id = tsq.question_id
         AND ua.user_id = auth.uid()
        WHERE ts.user_id = auth.uid()
          AND ts.question_bank_id = p_bank_id
          AND ts.is_completed = FALSE
          AND ua.id IS NULL
    ),
    flags AS (
        SELECT uqf.question_id
        FROM public.user_question_flags uqf
        WHERE uqf.user_id = auth.uid()
    )
    SELECT
        bq.question_id,
        CASE
            WHEN latest.question_id IS NULL THEN NULL
            WHEN latest.is_correct THEN 'correct'
            ELSE 'incorrect'
        END AS answer_state,
        suspended.question_id IS NOT NULL AS is_suspended,
        flags.question_id IS NOT NULL AS is_flagged,
        latest.question_id IS NULL AND suspended.question_id IS NULL AS is_new
    FROM bank_questions bq
    LEFT JOIN latest ON latest.question_id = bq.question_id
    LEFT JOIN suspended ON suspended.question_id = bq.question_id
    LEFT JOIN flags ON flags.question_id = bq.question_id
    WHERE public.can_access_question_bank(p_bank_id);
$$;

REVOKE ALL ON FUNCTION public.get_user_question_states(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_question_states(BIGINT) TO authenticated;
