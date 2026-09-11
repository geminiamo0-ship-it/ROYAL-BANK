-- Cache expensive per-user performance analytics while preserving the existing
-- calculation as an internal implementation. Cache entries are invalidated by the
-- same answer/flag/session dirty path as the question-bank dashboard, plus content
-- benchmark/name changes. A date key prevents stale answered-today/streak values.

ALTER FUNCTION public.get_question_bank_performance(BIGINT)
    RENAME TO compute_question_bank_performance;

REVOKE ALL ON FUNCTION public.compute_question_bank_performance(BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_question_bank_performance(BIGINT)
    TO service_role;

CREATE TABLE public.question_bank_performance_cache (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_bank_id BIGINT NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_dirty BOOLEAN NOT NULL DEFAULT TRUE,
    calculated_on DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, question_bank_id)
);

ALTER TABLE public.question_bank_performance_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_bank_performance_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.question_bank_performance_cache TO service_role;

CREATE OR REPLACE FUNCTION public.get_question_bank_performance(p_bank_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_payload JSONB;
    v_is_dirty BOOLEAN;
    v_calculated_on DATE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT cache.payload, cache.is_dirty, cache.calculated_on
    INTO v_payload, v_is_dirty, v_calculated_on
    FROM public.question_bank_performance_cache cache
    WHERE cache.user_id = v_user_id
      AND cache.question_bank_id = p_bank_id;

    IF FOUND AND v_is_dirty = FALSE AND v_calculated_on = CURRENT_DATE THEN
        RETURN v_payload;
    END IF;

    -- Prevent a thundering herd from recomputing the same user/bank payload.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'royal:bank-performance:' || v_user_id::text || ':' || p_bank_id::text,
            0
        )
    );

    -- Another concurrent request may have filled the cache while this request waited.
    SELECT cache.payload, cache.is_dirty, cache.calculated_on
    INTO v_payload, v_is_dirty, v_calculated_on
    FROM public.question_bank_performance_cache cache
    WHERE cache.user_id = v_user_id
      AND cache.question_bank_id = p_bank_id;

    IF FOUND AND v_is_dirty = FALSE AND v_calculated_on = CURRENT_DATE THEN
        RETURN v_payload;
    END IF;

    v_payload := public.compute_question_bank_performance(p_bank_id);

    INSERT INTO public.question_bank_performance_cache (
        user_id,
        question_bank_id,
        payload,
        is_dirty,
        calculated_on,
        updated_at
    )
    VALUES (
        v_user_id,
        p_bank_id,
        v_payload,
        FALSE,
        CURRENT_DATE,
        timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        payload = EXCLUDED.payload,
        is_dirty = FALSE,
        calculated_on = EXCLUDED.calculated_on,
        updated_at = EXCLUDED.updated_at;

    RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_bank_performance(BIGINT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_question_bank_performance(BIGINT)
    TO authenticated, service_role;

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
        user_id, question_bank_id, payload, is_dirty, updated_at
    )
    VALUES (
        p_user_id, p_bank_id, '[]'::jsonb, TRUE, timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        is_dirty = TRUE,
        updated_at = timezone('utc'::text, now());

    INSERT INTO public.question_bank_performance_cache (
        user_id, question_bank_id, payload, is_dirty, calculated_on, updated_at
    )
    VALUES (
        p_user_id, p_bank_id, '{}'::jsonb, TRUE, NULL, timezone('utc'::text, now())
    )
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        is_dirty = TRUE,
        calculated_on = NULL,
        updated_at = timezone('utc'::text, now());
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_bank_question_stats()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    DELETE FROM public.bank_question_stats
    WHERE TRUE;

    INSERT INTO public.bank_question_stats(
        question_bank_id,
        category,
        topic,
        difficulty,
        total_questions,
        updated_at
    )
    SELECT
        qbq.question_bank_id,
        COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized'),
        COALESCE(q.topic, ''),
        COALESCE(q.difficulty, '1'),
        COUNT(*)::INTEGER,
        timezone('utc'::text, now())
    FROM public.question_bank_questions qbq
    JOIN public.questions q ON q.id = qbq.question_id
    WHERE COALESCE(q.difficulty, '1') IN ('1', '2', '3')
    GROUP BY
        qbq.question_bank_id,
        COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized'),
        COALESCE(q.topic, ''),
        COALESCE(q.difficulty, '1');

    UPDATE public.question_bank_dashboard_cache
    SET
        is_dirty = TRUE,
        updated_at = timezone('utc'::text, now())
    WHERE TRUE;

    UPDATE public.question_bank_performance_cache
    SET
        is_dirty = TRUE,
        calculated_on = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.performance_cache_dirty_from_option()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_old_question_id BIGINT;
    v_new_question_id BIGINT;
BEGIN
    IF current_setting('royal.content_manager_bulk', TRUE) = '1' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old_question_id := OLD.question_id;
        UPDATE public.question_bank_performance_cache cache
        SET
            is_dirty = TRUE,
            calculated_on = NULL,
            updated_at = timezone('utc'::text, now())
        WHERE EXISTS (
            SELECT 1
            FROM public.question_bank_questions qbq
            WHERE qbq.question_bank_id = cache.question_bank_id
              AND qbq.question_id = v_old_question_id
        );
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        v_new_question_id := NEW.question_id;
        UPDATE public.question_bank_performance_cache cache
        SET
            is_dirty = TRUE,
            calculated_on = NULL,
            updated_at = timezone('utc'::text, now())
        WHERE EXISTS (
            SELECT 1
            FROM public.question_bank_questions qbq
            WHERE qbq.question_bank_id = cache.question_bank_id
              AND qbq.question_id = v_new_question_id
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.performance_cache_dirty_from_option()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS performance_cache_dirty_options ON public.options;
CREATE TRIGGER performance_cache_dirty_options
AFTER INSERT OR DELETE OR UPDATE OF is_correct, percentage, question_id
ON public.options
FOR EACH ROW
EXECUTE FUNCTION public.performance_cache_dirty_from_option();

CREATE OR REPLACE FUNCTION public.performance_cache_dirty_from_bank_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    UPDATE public.question_bank_performance_cache cache
    SET
        is_dirty = TRUE,
        calculated_on = NULL,
        updated_at = timezone('utc'::text, now())
    WHERE cache.question_bank_id = NEW.id;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.performance_cache_dirty_from_bank_metadata()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS performance_cache_dirty_bank_metadata ON public.question_banks;
CREATE TRIGGER performance_cache_dirty_bank_metadata
AFTER UPDATE OF name, description ON public.question_banks
FOR EACH ROW
EXECUTE FUNCTION public.performance_cache_dirty_from_bank_metadata();
