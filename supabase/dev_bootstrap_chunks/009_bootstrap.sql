SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

-- Keep the cached question-bank outline compatible with server-side service-role reads
-- while preserving canonical bank authorization for normal authenticated callers.
-- Aggregate directly from the bank/question mapping so difficulty totals cannot drift
-- from the source rows used by the exam selector.

CREATE OR REPLACE FUNCTION public.get_category_topic_counts_json(p_bank_id INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    result JSON;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required';
        END IF;

        IF NOT public.can_access_question_bank(p_bank_id::BIGINT) THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    END IF;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    INTO result
    FROM (
        SELECT
            q.category,
            q.topic,
            COALESCE(q.difficulty, '1') AS difficulty,
            COUNT(*)::INT AS total_questions
        FROM public.question_bank_questions qbq
        JOIN public.questions q
          ON q.id = qbq.question_id
        WHERE qbq.question_bank_id = p_bank_id
        GROUP BY
            q.category,
            q.topic,
            COALESCE(q.difficulty, '1')
        ORDER BY
            q.category,
            q.topic NULLS FIRST,
            COALESCE(q.difficulty, '1')
    ) t;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(INT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(INT) FROM anon;

GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(INT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(INT) TO service_role;

-- Precomputed question-bank dashboard for low-latency category/topic state reads.
--
-- Design:
--   1. bank_question_stats stores the slow-changing bank/category/topic/difficulty totals.
--   2. question_bank_dashboard_cache stores a ready-to-render JSON payload per user/bank.
--   3. state-changing tables only mark the user/bank cache dirty.
--   4. get_question_bank_dashboard() recomputes only on a cache miss/dirty row, entirely
--      inside Postgres, then serves subsequent reads from the tiny cache table.
--
-- The canonical New/Correct/Incorrect/Suspended/Flagged semantics remain owned by
-- get_user_question_states(); this migration only moves aggregation/caching into Postgres.

CREATE TABLE IF NOT EXISTS public.bank_question_stats (
    question_bank_id BIGINT NOT NULL
        REFERENCES public.question_banks(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL CHECK (difficulty IN ('1', '2', '3')),
    total_questions INTEGER NOT NULL CHECK (total_questions >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (question_bank_id, category, topic, difficulty)
);

ALTER TABLE public.bank_question_stats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bank_question_stats FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bank_question_stats FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.question_bank_dashboard_cache (
    user_id UUID NOT NULL
        REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_bank_id BIGINT NOT NULL
        REFERENCES public.question_banks(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_dirty BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, question_bank_id)
);

ALTER TABLE public.question_bank_dashboard_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.question_bank_dashboard_cache FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.question_bank_dashboard_cache FROM PUBLIC, anon, authenticated;

-- get_user_question_states filters sessions by owner/bank/completion repeatedly.
CREATE INDEX IF NOT EXISTS idx_test_sessions_user_bank_completion
    ON public.test_sessions(user_id, question_bank_id, is_completed, id);

CREATE OR REPLACE FUNCTION public.mark_question_bank_dashboard_dirty(
    p_user_id UUID,
    p_bank_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF p_user_id IS NULL OR p_bank_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.question_bank_dashboard_cache (
        user_id,
        question_bank_id,
        payload,
        is_dirty,
        updated_at
    )
    VALUES (
        p_user_id,
        p_bank_id,
        '[]'::jsonb,
        TRUE,
        timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        is_dirty = TRUE,
        updated_at = timezone('utc'::text, now());
END;
$$;

REVOKE ALL ON FUNCTION public.mark_question_bank_dashboard_dirty(UUID, BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_question_bank_dashboard_dirty_for_question(
    p_user_id UUID,
    p_question_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    bank_row RECORD;
BEGIN
    IF p_user_id IS NULL OR p_question_id IS NULL THEN
        RETURN;
    END IF;

    FOR bank_row IN
        SELECT qbq.question_bank_id
        FROM public.question_bank_questions qbq
        WHERE qbq.question_id = p_question_id
    LOOP
        PERFORM public.mark_question_bank_dashboard_dirty(
            p_user_id,
            bank_row.question_bank_id
        );
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_question_bank_dashboard_dirty_for_question(UUID, BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_bank_question_stats()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    DELETE FROM public.bank_question_stats;

    INSERT INTO public.bank_question_stats (
        question_bank_id,
        category,
        topic,
        difficulty,
        total_questions,
        updated_at
    )
    SELECT
        qbq.question_bank_id,
        COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized') AS category,
        COALESCE(q.topic, '') AS topic,
        COALESCE(q.difficulty, '1') AS difficulty,
        COUNT(*)::INTEGER AS total_questions,
        timezone('utc'::text, now()) AS updated_at
    FROM public.question_bank_questions qbq
    JOIN public.questions q
      ON q.id = qbq.question_id
    WHERE COALESCE(q.difficulty, '1') IN ('1', '2', '3')
    GROUP BY
        qbq.question_bank_id,
        COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized'),
        COALESCE(q.topic, ''),
        COALESCE(q.difficulty, '1');

    -- Question/mapping metadata changed, so every existing cached outline is stale.
    UPDATE public.question_bank_dashboard_cache
    SET
        is_dirty = TRUE,
        updated_at = timezone('utc'::text, now());
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_bank_question_stats() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_bank_question_stats_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    PERFORM public.refresh_bank_question_stats();
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_bank_question_stats_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refresh_bank_question_stats_from_mapping
    ON public.question_bank_questions;

CREATE TRIGGER refresh_bank_question_stats_from_mapping
AFTER INSERT OR UPDATE OR DELETE ON public.question_bank_questions
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_bank_question_stats_trigger();

DROP TRIGGER IF EXISTS refresh_bank_question_stats_from_question_metadata
    ON public.questions;

CREATE TRIGGER refresh_bank_question_stats_from_question_metadata
AFTER UPDATE OF category, topic, difficulty ON public.questions
FOR EACH STATEMENT
EXECUTE FUNCTION public.refresh_bank_question_stats_trigger();

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_from_answer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM public.mark_question_bank_dashboard_dirty_for_question(
            OLD.user_id,
            OLD.question_id
        );
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.mark_question_bank_dashboard_dirty_for_question(
            NEW.user_id,
            NEW.question_id
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_from_answer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dashboard_cache_dirty_user_answers
    ON public.user_answers;

CREATE TRIGGER dashboard_cache_dirty_user_answers
AFTER INSERT OR UPDATE OR DELETE ON public.user_answers
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_cache_dirty_from_answer();

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_from_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM public.mark_question_bank_dashboard_dirty_for_question(
            OLD.user_id,
            OLD.question_id
        );
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.mark_question_bank_dashboard_dirty_for_question(
            NEW.user_id,
            NEW.question_id
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_from_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dashboard_cache_dirty_question_flags
    ON public.user_question_flags;

CREATE TRIGGER dashboard_cache_dirty_question_flags
AFTER INSERT OR UPDATE OR DELETE ON public.user_question_flags
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_cache_dirty_from_flag();

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_from_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM public.mark_question_bank_dashboard_dirty(
            OLD.user_id,
            OLD.question_bank_id
        );
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.mark_question_bank_dashboard_dirty(
            NEW.user_id,
            NEW.question_bank_id
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_from_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dashboard_cache_dirty_test_sessions
    ON public.test_sessions;

CREATE TRIGGER dashboard_cache_dirty_test_sessions
AFTER INSERT OR UPDATE OR DELETE ON public.test_sessions
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_cache_dirty_from_session();

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_from_session_question()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    session_row RECORD;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT ts.user_id, ts.question_bank_id
        INTO session_row
        FROM public.test_sessions ts
        WHERE ts.id = OLD.test_session_id;

        IF FOUND THEN
            PERFORM public.mark_question_bank_dashboard_dirty(
                session_row.user_id,
                session_row.question_bank_id
            );
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT ts.user_id, ts.question_bank_id
        INTO session_row
        FROM public.test_sessions ts
        WHERE ts.id = NEW.test_session_id;

        IF FOUND THEN
            PERFORM public.mark_question_bank_dashboard_dirty(
                session_row.user_id,
                session_row.question_bank_id
            );
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_from_session_question() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dashboard_cache_dirty_session_questions
    ON public.test_session_questions;

CREATE TRIGGER dashboard_cache_dirty_session_questions
AFTER INSERT OR UPDATE OR DELETE ON public.test_session_questions
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_cache_dirty_from_session_question();

CREATE OR REPLACE FUNCTION public.get_question_bank_dashboard(p_bank_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    cached_payload JSONB;
    cached_dirty BOOLEAN;
    result_payload JSONB;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT cache.payload, cache.is_dirty
    INTO cached_payload, cached_dirty
    FROM public.question_bank_dashboard_cache cache
    WHERE cache.user_id = auth.uid()
      AND cache.question_bank_id = p_bank_id;

    IF FOUND AND cached_dirty = FALSE THEN
        RETURN cached_payload;
    END IF;

    WITH state_rollup AS (
        SELECT
            COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized') AS category,
            COALESCE(q.topic, '') AS topic,
            COALESCE(q.difficulty, '1') AS difficulty,
            COUNT(*) FILTER (WHERE state.answer_state IS NOT NULL)::INTEGER AS attempted_count,
            COUNT(*) FILTER (WHERE state.answer_state = 'incorrect')::INTEGER AS incorrect_count,
            COUNT(*) FILTER (WHERE state.is_flagged)::INTEGER AS flagged_count,
            COUNT(*) FILTER (WHERE state.is_suspended)::INTEGER AS suspended_count,
            COUNT(*) FILTER (WHERE state.is_new)::INTEGER AS new_count
        FROM public.get_user_question_states(p_bank_id) state
        JOIN public.questions q
          ON q.id = state.question_id
        WHERE COALESCE(q.difficulty, '1') IN ('1', '2', '3')
        GROUP BY
            COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized'),
            COALESCE(q.topic, ''),
            COALESCE(q.difficulty, '1')
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'category', totals.category,
                'topic', NULLIF(totals.topic, ''),
                'difficulty', totals.difficulty,
                'total_questions', totals.total_questions,
                'attempted_count', COALESCE(state_rollup.attempted_count, 0),
                'incorrect_count', COALESCE(state_rollup.incorrect_count, 0),
                'flagged_count', COALESCE(state_rollup.flagged_count, 0),
                'suspended_count', COALESCE(state_rollup.suspended_count, 0),
                'new_count', COALESCE(state_rollup.new_count, totals.total_questions)
            )
            ORDER BY totals.category, totals.topic, totals.difficulty
        ),
        '[]'::jsonb
    )
    INTO result_payload
    FROM public.bank_question_stats totals
    LEFT JOIN state_rollup
      ON state_rollup.category = totals.category
     AND state_rollup.topic = totals.topic
     AND state_rollup.difficulty = totals.difficulty
    WHERE totals.question_bank_id = p_bank_id;

    INSERT INTO public.question_bank_dashboard_cache (
        user_id,
        question_bank_id,
        payload,
        is_dirty,
        updated_at
    )
    VALUES (
        auth.uid(),
        p_bank_id,
        result_payload,
        FALSE,
        timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        payload = EXCLUDED.payload,
        is_dirty = FALSE,
        updated_at = EXCLUDED.updated_at;

    RETURN result_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_bank_dashboard(BIGINT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_question_bank_dashboard(BIGINT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_question_bank_dashboard(BIGINT) TO service_role;

COMMENT ON TABLE public.bank_question_stats IS
    'Precomputed slow-changing bank/category/topic/difficulty totals. Refreshed when bank mappings or question metadata change.';

COMMENT ON TABLE public.question_bank_dashboard_cache IS
    'Ready-to-render per-user question-bank summary payload. State-changing triggers mark rows dirty; the dashboard RPC refreshes only dirty/missing entries.';

COMMENT ON FUNCTION public.get_question_bank_dashboard(BIGINT) IS
    'Fast question-bank dashboard boundary. Serves cached per-user aggregates and recomputes canonical question state inside Postgres only when dirty.';

-- Seed static totals for existing banks/questions. The cache starts empty and is filled lazily.
SELECT public.refresh_bank_question_stats();

-- Remove the legacy INTEGER overload of create_exam_session.
-- PostgREST cannot disambiguate JSON numeric arguments when both INTEGER and BIGINT
-- overloads exist with the same parameter names, causing exam creation to fail.

DROP FUNCTION IF EXISTS public.create_exam_session(
    UUID,
    INTEGER,
    TEXT,
    INTEGER,
    TEXT[],
    TEXT[],
    JSONB,
    TEXT
);

-- Keep PostgREST's function cache in sync after removing the overload.
NOTIFY pgrst, 'reload schema';
