-- Align Revision with the same canonical latest-question semantics used by
-- get_user_question_states across legacy Postgres + Cloudflare/Edge history.
-- Also retain the latest selected option/release in bounded edge question state
-- so Revision can remain fully read-only without exposing user_answers.

ALTER TABLE public.edge_user_question_state
  ADD COLUMN IF NOT EXISTS selected_option_id bigint,
  ADD COLUMN IF NOT EXISTS last_release_id text;

-- Best-effort backfill from still-retained edge answer/session rows.
UPDATE public.edge_user_question_state state
SET
  selected_option_id = source.selected_option_id,
  last_release_id = COALESCE(source.release_id, state.last_release_id)
FROM (
  SELECT DISTINCT ON (a.user_id, a.question_id)
    a.user_id,
    a.question_id,
    a.selected_option_id,
    s.release_id,
    a.answered_at
  FROM public.edge_exam_answers a
  LEFT JOIN public.edge_exam_sessions s
    ON s.session_id = a.session_id
   AND s.user_id = a.user_id
  WHERE a.selected_option_id IS NOT NULL
  ORDER BY a.user_id, a.question_id, a.answered_at DESC NULLS LAST, a.stream_version DESC
) source
WHERE state.user_id = source.user_id
  AND state.question_id = source.question_id
  AND (
    state.last_answered_at IS NULL
    OR source.answered_at IS NULL
    OR source.answered_at >= state.last_answered_at
  );

UPDATE public.edge_user_question_state state
SET last_release_id = session.release_id
FROM public.edge_exam_sessions session
WHERE state.user_id = session.user_id
  AND state.last_session_id = session.session_id
  AND state.last_release_id IS NULL
  AND session.release_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_revision_edge_answer_detail()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
  v_user uuid;
  v_session uuid;
  v_release text;
  v_answer jsonb;
  v_answered_at timestamptz;
BEGIN
  v_user := new.user_id::uuid;
  v_session := NULLIF(new.session_id, '')::uuid;

  IF new.event_type = 'answer.finalized'
     AND NULLIF(new.payload->>'question_id', '') IS NOT NULL
     AND NULLIF(new.payload->>'selected_option_id', '') IS NOT NULL THEN
    SELECT s.release_id INTO v_release
    FROM public.edge_exam_sessions s
    WHERE s.session_id = COALESCE(
      NULLIF(new.payload->>'session_id', '')::uuid,
      v_session
    )
      AND s.user_id = v_user;

    v_answered_at := new.occurred_at;

    UPDATE public.edge_user_question_state state
    SET
      selected_option_id = (new.payload->>'selected_option_id')::bigint,
      last_release_id = COALESCE(v_release, state.last_release_id),
      updated_at = now()
    WHERE state.user_id = v_user
      AND state.question_id = (new.payload->>'question_id')::bigint
      AND (
        state.last_answered_at IS NULL
        OR v_answered_at >= state.last_answered_at
      );

  ELSIF new.event_type = 'session.completed'
        AND jsonb_typeof(COALESCE(new.payload->'answers', '[]'::jsonb)) = 'array' THEN
    v_release := NULLIF(new.payload->>'release_id', '');
    v_answered_at := COALESCE(
      NULLIF(new.payload->>'completed_at', '')::timestamptz,
      new.occurred_at
    );

    FOR v_answer IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(new.payload->'answers', '[]'::jsonb))
    LOOP
      IF NULLIF(v_answer->>'question_id', '') IS NULL
         OR NULLIF(v_answer->>'selected_option_id', '') IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.edge_user_question_state state
      SET
        selected_option_id = (v_answer->>'selected_option_id')::bigint,
        last_release_id = COALESCE(v_release, state.last_release_id),
        updated_at = now()
      WHERE state.user_id = v_user
        AND state.question_id = (v_answer->>'question_id')::bigint
        AND (
          state.last_answered_at IS NULL
          OR v_answered_at >= state.last_answered_at
        );
    END LOOP;
  END IF;

  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_revision_edge_answer_detail()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_revision_edge_answer_detail()
  TO service_role;

DROP TRIGGER IF EXISTS zz_capture_revision_edge_answer_detail
  ON public.edge_exam_sync_inbox;
CREATE TRIGGER zz_capture_revision_edge_answer_detail
AFTER INSERT ON public.edge_exam_sync_inbox
FOR EACH ROW
EXECUTE FUNCTION public.capture_revision_edge_answer_detail();

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
    source text
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
      latest.source
    FROM latest
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
    source text
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
      idx.source
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
  'Canonical read-only Revision index using the same latest-answer precedence as get_user_question_states across legacy and Edge history.';
COMMENT ON FUNCTION public.get_revision_question_detail(bigint, bigint) IS
  'Canonical read-only Revision detail row; selected_option_id may be null only for historical Edge answers created before bounded detail retention was enabled.';
