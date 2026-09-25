-- Read-only Revision backend.
--
-- Exposes only the authenticated user's latest finalized answer state for an
-- accessible bank. Question/explanation/correct-answer content stays in R2.
-- No Revision RPC below mutates answer, flag, session, or disclosure state.
--
-- The content release is read through to_jsonb(test_sessions) so this migration
-- is compatible with older DEV schemas that predate content_release_id.

CREATE OR REPLACE FUNCTION public.get_revision_question_index(
    p_bank_id bigint
)
RETURNS TABLE (
    question_id bigint,
    answer_state text,
    selected_option_id bigint,
    is_flagged boolean,
    answered_at timestamptz,
    test_session_id uuid,
    content_release_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    WITH authorized AS (
        SELECT auth.uid() AS user_id
        WHERE auth.uid() IS NOT NULL
          AND public.is_active_user()
          AND public.can_access_question_bank(p_bank_id)
    ),
    latest AS (
        SELECT DISTINCT ON (ua.question_id)
            ua.question_id,
            ua.selected_option_id,
            ua.is_correct,
            ua.answered_at,
            ua.test_session_id,
            NULLIF(to_jsonb(ts)->>'content_release_id', '') AS content_release_id
        FROM authorized a
        JOIN public.user_answers ua
          ON ua.user_id = a.user_id
        JOIN public.test_sessions ts
          ON ts.id = ua.test_session_id
         AND ts.user_id = a.user_id
         AND ts.question_bank_id = p_bank_id
        JOIN public.question_bank_questions qbq
          ON qbq.question_bank_id = p_bank_id
         AND qbq.question_id = ua.question_id
        WHERE ua.selected_option_id IS NOT NULL
          AND (
              ts.is_completed = TRUE
              OR ts.session_type IN ('standard', 'tutor')
          )
        ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
    )
    SELECT
        latest.question_id,
        CASE WHEN latest.is_correct THEN 'correct' ELSE 'incorrect' END::text AS answer_state,
        latest.selected_option_id,
        (uqf.question_id IS NOT NULL) AS is_flagged,
        latest.answered_at,
        latest.test_session_id,
        latest.content_release_id
    FROM latest
    LEFT JOIN public.user_question_flags uqf
      ON uqf.user_id = auth.uid()
     AND uqf.question_id = latest.question_id
    ORDER BY latest.answered_at DESC, latest.question_id DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_revision_question_detail(
    p_bank_id bigint,
    p_question_id bigint
)
RETURNS TABLE (
    question_id bigint,
    answer_state text,
    selected_option_id bigint,
    is_flagged boolean,
    answered_at timestamptz,
    test_session_id uuid,
    content_release_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    SELECT
        idx.question_id,
        idx.answer_state,
        idx.selected_option_id,
        idx.is_flagged,
        idx.answered_at,
        idx.test_session_id,
        idx.content_release_id
    FROM public.get_revision_question_index(p_bank_id) AS idx
    WHERE idx.question_id = p_question_id
    LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_revision_question_index(bigint)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_revision_question_detail(bigint, bigint)
    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_revision_question_index(bigint)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revision_question_detail(bigint, bigint)
    TO authenticated, service_role;

COMMENT ON FUNCTION public.get_revision_question_index(bigint) IS
    'Read-only Revision boundary: latest finalized answer per question for the authenticated user and accessible bank, including persistent flag state and pinned release when available.';

COMMENT ON FUNCTION public.get_revision_question_detail(bigint, bigint) IS
    'Read-only Revision detail boundary for one previously answered bank question. No answer/session/flag mutation occurs.';
