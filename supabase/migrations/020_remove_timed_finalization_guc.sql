-- X-audit hardening: do not use a custom PostgreSQL GUC as proof that a NULL
-- answer came from trusted timed-session finalization. A security decision must not
-- depend on client-controllable session state.
--
-- The trusted completion function now writes an uncommitted marker into a private,
-- non-API table. The answer trigger can see that marker only inside the same
-- transaction. Browser roles have neither schema access nor table privileges.

CREATE TABLE private.exam_timed_finalization_context (
    transaction_id BIGINT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (transaction_id, user_id, session_id)
);

ALTER TABLE private.exam_timed_finalization_context ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.exam_timed_finalization_context
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    option_is_correct BOOLEAN;
    session_mode TEXT;
    trusted_timed_finalization BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Answer user does not match authenticated user';
    END IF;

    SELECT ts.session_type
    INTO session_mode
    FROM public.test_sessions ts
    WHERE ts.id = NEW.test_session_id
      AND ts.user_id = NEW.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    -- Check locked-session membership before inspecting disclosure or option data.
    IF to_regclass('public.test_session_questions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM public.test_session_questions tsq
            WHERE tsq.test_session_id = NEW.test_session_id
              AND tsq.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    trusted_timed_finalization :=
        session_mode IN ('timed', 'fixed_timed')
        AND EXISTS (
            SELECT 1
            FROM private.exam_timed_finalization_context ctx
            WHERE ctx.transaction_id = txid_current()
              AND ctx.user_id = NEW.user_id
              AND ctx.session_id = NEW.test_session_id
        );

    IF NEW.selected_option_id IS NULL THEN
        IF NOT trusted_timed_finalization THEN
            RAISE EXCEPTION 'Submitted answer requires a selected option';
        END IF;
        NEW.is_correct := FALSE;
    ELSE
        -- Preserve migration 017's disclosure gate: selected answers are accepted
        -- only for content that this user has actually received.
        IF NOT EXISTS (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = NEW.user_id
              AND d.question_id = NEW.question_id
        ) THEN
            RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
        END IF;

        SELECT o.is_correct
        INTO option_is_correct
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected option does not belong to question';
        END IF;

        NEW.is_correct := option_is_correct;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_exam_session(p_session_id UUID)
RETURNS public.test_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.test_sessions;
    v_txid BIGINT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO result
    FROM public.test_sessions
    WHERE id = p_session_id
      AND user_id = auth.uid()
    FOR UPDATE;

    IF result.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF result.is_completed THEN
        RETURN result;
    END IF;

    IF result.session_type IN ('timed', 'fixed_timed') THEN
        v_txid := txid_current();

        INSERT INTO private.exam_timed_finalization_context(
            transaction_id,
            user_id,
            session_id
        ) VALUES (
            v_txid,
            result.user_id,
            result.id
        );

        INSERT INTO public.user_answers (
            test_session_id,
            user_id,
            question_id,
            selected_option_id,
            is_correct,
            is_flagged,
            time_spent_seconds
        )
        SELECT
            result.id,
            result.user_id,
            tsq.question_id,
            NULL,
            FALSE,
            FALSE,
            0
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = result.id
          AND NOT EXISTS (
              SELECT 1
              FROM public.user_answers ua
              WHERE ua.test_session_id = result.id
                AND ua.user_id = result.user_id
                AND ua.question_id = tsq.question_id
          );

        DELETE FROM private.exam_timed_finalization_context ctx
        WHERE ctx.transaction_id = v_txid
          AND ctx.user_id = result.user_id
          AND ctx.session_id = result.id;
    END IF;

    UPDATE public.test_sessions
    SET is_completed = TRUE
    WHERE id = result.id
      AND user_id = result.user_id
      AND is_completed = FALSE
    RETURNING * INTO result;

    RETURN result;
END;
$$;
