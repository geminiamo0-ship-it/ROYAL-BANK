-- Revision taxonomy metadata.
-- Keeps the read-only revision state canonical across legacy + Edge history,
-- while returning category/topic/difficulty directly from authoritative DB metadata.

DROP FUNCTION IF EXISTS public.get_revision_question_detail(bigint, bigint);
DROP FUNCTION IF EXISTS public.get_revision_question_index(bigint);

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
    content_release_id text,
    source text,
    category text,
    topic text,
    difficulty text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    WITH bank_questions AS (
      SELECT qbq.question_id
      FROM public.question_bank_questions qbq
      WHERE qbq.question_bank_id = p_bank_id
    ),
    legacy_candidates AS (
      SELECT
        ua.question_id,
        CASE WHEN ua.is_correct THEN 'correct' ELSE 'incorrect' END::text AS answer_state,
        ua.selected_option_id,
        ua.answered_at,
        ua.test_session_id,
        NULLIF(to_jsonb(ts)->>'content_release_id', '') AS content_release_id,
        0 AS source_rank,
        'legacy'::text AS source
      FROM public.user_answers ua
      JOIN public.test_sessions ts
        ON ts.id = ua.test_session_id
       AND ts.user_id = ua.user_id
      JOIN bank_questions bq
        ON bq.question_id = ua.question_id
      WHERE ua.user_id = auth.uid()
        AND ua.selected_option_id IS NOT NULL
        AND (
          ts.is_completed = TRUE
          OR ts.session_type IN ('standard', 'tutor')
        )
    ),
    edge_candidates AS (
      SELECT
        edge.question_id,
        edge.answer_state,
        edge.selected_option_id,
        edge.last_answered_at AS answered_at,
        edge.last_session_id AS test_session_id,
        COALESCE(edge.last_release_id, session.release_id) AS content_release_id,
        1 AS source_rank,
        'edge'::text AS source
      FROM public.edge_user_question_state edge
      JOIN bank_questions bq
        ON bq.question_id = edge.question_id
      LEFT JOIN public.edge_exam_sessions session
        ON session.session_id = edge.last_session_id
       AND session.user_id = edge.user_id
      WHERE edge.user_id = auth.uid()
        AND edge.answer_state IS NOT NULL
    ),
    latest AS (
      SELECT DISTINCT ON (candidate.question_id)
        candidate.question_id,
        candidate.answer_state,
        candidate.selected_option_id,
        candidate.answered_at,
        candidate.test_session_id,
        candidate.content_release_id,
        candidate.source
      FROM (
        SELECT * FROM legacy_candidates
        UNION ALL
        SELECT * FROM edge_candidates
      ) candidate
      ORDER BY
        candidate.question_id,
        candidate.answered_at DESC NULLS LAST,
        candidate.source_rank DESC
    ),
    legacy_flags AS (
      SELECT f.question_id, f.flagged_at
      FROM public.user_question_flags f
      WHERE f.user_id = auth.uid()
    )
    SELECT
      latest.question_id,
      latest.answer_state,
      latest.selected_option_id,
      CASE
        WHEN ef.question_id IS NOT NULL
         AND (lf.question_id IS NULL OR ef.updated_at >= lf.flagged_at)
          THEN ef.flagged
        ELSE lf.question_id IS NOT NULL
      END AS is_flagged,
      latest.answered_at,
      latest.test_session_id,
      latest.content_release_id,
      latest.source,
      NULLIF(BTRIM(q.category), '') AS category,
      NULLIF(BTRIM(q.topic), '') AS topic,
      COALESCE(NULLIF(BTRIM(q.difficulty), ''), '1') AS difficulty
    FROM latest
    JOIN public.questions q
      ON q.id = latest.question_id
    LEFT JOIN legacy_flags lf
      ON lf.question_id = latest.question_id
    LEFT JOIN public.edge_exam_flags ef
      ON ef.user_id = auth.uid()
     AND ef.question_id = latest.question_id
    WHERE auth.uid() IS NOT NULL
      AND public.is_active_user()
      AND public.can_access_question_bank(p_bank_id)
    ORDER BY latest.answered_at DESC NULLS LAST, latest.question_id DESC;
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
    content_release_id text,
    source text,
    category text,
    topic text,
    difficulty text
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
      idx.content_release_id,
      idx.source,
      idx.category,
      idx.topic,
      idx.difficulty
    FROM public.get_revision_question_index(p_bank_id) idx
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
  'Canonical read-only Revision index across legacy + Edge state with authoritative current category/topic/difficulty metadata.';
COMMENT ON FUNCTION public.get_revision_question_detail(bigint, bigint) IS
  'Canonical read-only Revision detail including taxonomy metadata for one previously answered question.';
