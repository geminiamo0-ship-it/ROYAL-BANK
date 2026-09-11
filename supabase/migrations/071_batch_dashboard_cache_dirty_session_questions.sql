-- Reduce Create-session write amplification under concurrent load.
--
-- test_session_questions is populated in one bulk INSERT for a newly-created exam.
-- The previous AFTER ... FOR EACH ROW trigger invalidated two dashboard caches for
-- every inserted question. A 40-question Create therefore performed ~80 cache
-- UPSERTs, even though all rows belong to the same user/bank and need only one
-- invalidation per statement.
--
-- Preserve the exact invalidation semantics for INSERT/UPDATE/DELETE, but batch by
-- distinct session ids using transition tables. No exam authorization, disclosure,
-- release-pinning, answer, or quota behavior is changed.

CREATE OR REPLACE FUNCTION private.mark_question_bank_dashboard_dirty_for_sessions(
    p_session_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    IF COALESCE(cardinality(p_session_ids), 0) = 0 THEN
        RETURN;
    END IF;

    INSERT INTO public.question_bank_dashboard_cache (
        user_id,
        question_bank_id,
        payload,
        is_dirty,
        updated_at
    )
    SELECT DISTINCT
        ts.user_id,
        ts.question_bank_id,
        '[]'::jsonb,
        TRUE,
        timezone('utc'::text, now())
    FROM public.test_sessions ts
    WHERE ts.id = ANY(p_session_ids)
      AND ts.user_id IS NOT NULL
      AND ts.question_bank_id IS NOT NULL
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        is_dirty = TRUE,
        updated_at = EXCLUDED.updated_at;

    INSERT INTO public.question_bank_performance_cache (
        user_id,
        question_bank_id,
        payload,
        is_dirty,
        calculated_on,
        updated_at
    )
    SELECT DISTINCT
        ts.user_id,
        ts.question_bank_id,
        '{}'::jsonb,
        TRUE,
        NULL,
        timezone('utc'::text, now())
    FROM public.test_sessions ts
    WHERE ts.id = ANY(p_session_ids)
      AND ts.user_id IS NOT NULL
      AND ts.question_bank_id IS NOT NULL
    ON CONFLICT (user_id, question_bank_id)
    DO UPDATE SET
        is_dirty = TRUE,
        calculated_on = NULL,
        updated_at = EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION private.mark_question_bank_dashboard_dirty_for_sessions(uuid[])
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_session_questions_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT rows.test_session_id)
    INTO v_session_ids
    FROM new_rows rows;

    PERFORM private.mark_question_bank_dashboard_dirty_for_sessions(v_session_ids);
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_session_questions_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT affected.test_session_id)
    INTO v_session_ids
    FROM (
        SELECT rows.test_session_id FROM old_rows rows
        UNION
        SELECT rows.test_session_id FROM new_rows rows
    ) affected;

    PERFORM private.mark_question_bank_dashboard_dirty_for_sessions(v_session_ids);
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_session_questions_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT rows.test_session_id)
    INTO v_session_ids
    FROM old_rows rows;

    PERFORM private.mark_question_bank_dashboard_dirty_for_sessions(v_session_ids);
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_session_questions_insert_stmt()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_session_questions_update_stmt()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_session_questions_delete_stmt()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dashboard_cache_dirty_session_questions
    ON public.test_session_questions;
DROP TRIGGER IF EXISTS dashboard_cache_dirty_session_questions_insert_stmt
    ON public.test_session_questions;
DROP TRIGGER IF EXISTS dashboard_cache_dirty_session_questions_update_stmt
    ON public.test_session_questions;
DROP TRIGGER IF EXISTS dashboard_cache_dirty_session_questions_delete_stmt
    ON public.test_session_questions;

CREATE TRIGGER dashboard_cache_dirty_session_questions_insert_stmt
AFTER INSERT ON public.test_session_questions
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.dashboard_cache_dirty_session_questions_insert_stmt();

CREATE TRIGGER dashboard_cache_dirty_session_questions_update_stmt
AFTER UPDATE ON public.test_session_questions
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.dashboard_cache_dirty_session_questions_update_stmt();

CREATE TRIGGER dashboard_cache_dirty_session_questions_delete_stmt
AFTER DELETE ON public.test_session_questions
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.dashboard_cache_dirty_session_questions_delete_stmt();

COMMENT ON FUNCTION private.mark_question_bank_dashboard_dirty_for_sessions(uuid[]) IS
    'Batches question-bank dashboard/performance cache invalidation for distinct exam sessions touched by one test_session_questions statement.';
