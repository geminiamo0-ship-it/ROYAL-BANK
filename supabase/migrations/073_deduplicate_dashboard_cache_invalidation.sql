-- Reduce synchronous dashboard/performance cache write amplification during exam creation.
--
-- A normal R2-backed Create touches the same (user_id, question_bank_id) several times
-- in one transaction:
--   1) test_sessions INSERT
--   2) test_session_questions bulk INSERT
--   3) content_release_id UPDATE while pinning the R2 release
--
-- Each invalidation writes both dashboard and performance cache rows. Keep invalidation
-- transactional, but deduplicate it per (user, bank) for the current transaction. Also
-- skip the session UPDATE trigger when content_release_id is the only changed field,
-- because dashboard/performance calculations do not depend on that field.
--
-- Other session/question writes retain their invalidation semantics. No exam auth,
-- quota, disclosure, ordering, idempotency, or R2 release checks are changed.

CREATE OR REPLACE FUNCTION private.mark_question_bank_dashboard_dirty_once(
    p_user_id uuid,
    p_bank_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_seen text := COALESCE(NULLIF(current_setting('royal.dashboard_dirty_pairs', true), ''), '|');
    v_key text;
BEGIN
    IF p_user_id IS NULL OR p_bank_id IS NULL THEN
        RETURN;
    END IF;

    v_key := p_user_id::text || ':' || p_bank_id::text;
    IF position('|' || v_key || '|' IN v_seen) > 0 THEN
        RETURN;
    END IF;

    PERFORM public.mark_question_bank_dashboard_dirty(p_user_id, p_bank_id);

    -- Transaction-local marker: it disappears automatically at transaction end.
    PERFORM set_config(
        'royal.dashboard_dirty_pairs',
        v_seen || v_key || '|',
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.mark_question_bank_dashboard_dirty_once(uuid, bigint)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.mark_question_bank_dashboard_dirty_for_sessions(
    p_session_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_target record;
BEGIN
    IF COALESCE(cardinality(p_session_ids), 0) = 0 THEN
        RETURN;
    END IF;

    FOR v_target IN
        SELECT DISTINCT ts.user_id, ts.question_bank_id
        FROM public.test_sessions ts
        WHERE ts.id = ANY(p_session_ids)
          AND ts.user_id IS NOT NULL
          AND ts.question_bank_id IS NOT NULL
    LOOP
        PERFORM private.mark_question_bank_dashboard_dirty_once(
            v_target.user_id,
            v_target.question_bank_id
        );
    END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.mark_question_bank_dashboard_dirty_for_sessions(uuid[])
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_cache_dirty_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    -- R2 release pinning changes no dashboard/performance input. Avoid dirtying an
    -- already-valid cache when this is the only session field that changed.
    IF TG_OP = 'UPDATE'
       AND OLD.content_release_id IS DISTINCT FROM NEW.content_release_id
       AND (to_jsonb(OLD) - 'content_release_id') = (to_jsonb(NEW) - 'content_release_id') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        PERFORM private.mark_question_bank_dashboard_dirty_once(
            NEW.user_id,
            NEW.question_bank_id
        );
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM private.mark_question_bank_dashboard_dirty_once(
            OLD.user_id,
            OLD.question_bank_id
        );
        RETURN OLD;
    END IF;

    -- UPDATE: if ownership/bank did not move, invalidate the pair once. If either
    -- changed, invalidate both old and new pairs, still deduplicated transaction-wide.
    IF OLD.user_id IS NOT DISTINCT FROM NEW.user_id
       AND OLD.question_bank_id IS NOT DISTINCT FROM NEW.question_bank_id THEN
        PERFORM private.mark_question_bank_dashboard_dirty_once(
            NEW.user_id,
            NEW.question_bank_id
        );
    ELSE
        PERFORM private.mark_question_bank_dashboard_dirty_once(
            OLD.user_id,
            OLD.question_bank_id
        );
        PERFORM private.mark_question_bank_dashboard_dirty_once(
            NEW.user_id,
            NEW.question_bank_id
        );
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dashboard_cache_dirty_from_session()
    FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.mark_question_bank_dashboard_dirty_once(uuid, bigint) IS
    'Transaction-local deduplication wrapper for dashboard/performance cache invalidation by user and bank.';

COMMENT ON FUNCTION private.mark_question_bank_dashboard_dirty_for_sessions(uuid[]) IS
    'Batches session-question invalidation targets and deduplicates them against other invalidations in the same transaction.';
