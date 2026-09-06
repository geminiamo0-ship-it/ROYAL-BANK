-- Deleting an unfinished session releases unanswered locks but must not erase
-- finalized/submitted answer history. Preserve those answers by orphaning their
-- session reference immediately before the session row is deleted.

ALTER TABLE public.user_answers
    ALTER COLUMN test_session_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_answer_finalization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    mode TEXT;
    completed BOOLEAN;
    trusted_session_delete BOOLEAN :=
        COALESCE(current_setting('app.session_delete_preserve_answers', true), '') = 'on';
BEGIN
    IF trusted_session_delete
       AND OLD.test_session_id IS NOT NULL
       AND NEW.test_session_id IS NULL
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.question_id IS NOT DISTINCT FROM OLD.question_id
       AND NEW.selected_option_id IS NOT DISTINCT FROM OLD.selected_option_id
       AND NEW.is_correct IS NOT DISTINCT FROM OLD.is_correct
       AND NEW.is_flagged IS NOT DISTINCT FROM OLD.is_flagged
       AND NEW.time_spent_seconds IS NOT DISTINCT FROM OLD.time_spent_seconds
       AND NEW.answered_at IS NOT DISTINCT FROM OLD.answered_at THEN
        RETURN NEW;
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.test_session_id IS DISTINCT FROM OLD.test_session_id
       OR NEW.question_id IS DISTINCT FROM OLD.question_id THEN
        RAISE EXCEPTION 'Answer ownership and question fields are immutable';
    END IF;

    IF NEW.answered_at IS DISTINCT FROM OLD.answered_at
       AND NEW.selected_option_id IS NOT DISTINCT FROM OLD.selected_option_id THEN
        RAISE EXCEPTION 'Answer timestamp is server-managed';
    END IF;

    SELECT ts.session_type, ts.is_completed
    INTO mode, completed
    FROM public.test_sessions ts
    WHERE ts.id = OLD.test_session_id
      AND ts.user_id = OLD.user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF completed THEN
        RAISE EXCEPTION 'Answers cannot be changed after End Block';
    END IF;

    IF mode IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Submitted Standard/Tutor answers are final';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    option_is_correct BOOLEAN;
    trusted_timed_finalization BOOLEAN :=
        COALESCE(current_setting('app.timed_finalization', true), '') = 'on';
    trusted_session_delete BOOLEAN :=
        COALESCE(current_setting('app.session_delete_preserve_answers', true), '') = 'on';
BEGIN
    IF TG_OP = 'UPDATE'
       AND trusted_session_delete
       AND OLD.test_session_id IS NOT NULL
       AND NEW.test_session_id IS NULL
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
       AND NEW.question_id IS NOT DISTINCT FROM OLD.question_id
       AND NEW.selected_option_id IS NOT DISTINCT FROM OLD.selected_option_id
       AND NEW.is_correct IS NOT DISTINCT FROM OLD.is_correct THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Answer user does not match authenticated user';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = NEW.test_session_id
          AND ts.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    IF NEW.selected_option_id IS NULL THEN
        IF NOT trusted_timed_finalization THEN
            RAISE EXCEPTION 'Submitted answer requires a selected option';
        END IF;
        NEW.is_correct := FALSE;
    ELSE
        SELECT o.is_correct INTO option_is_correct
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected option does not belong to question';
        END IF;

        NEW.is_correct := option_is_correct;
    END IF;

    IF to_regclass('public.test_session_questions') IS NOT NULL
       AND NOT EXISTS (
            SELECT 1 FROM public.test_session_questions tsq
            WHERE tsq.test_session_id = NEW.test_session_id
              AND tsq.question_id = NEW.question_id
       ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.preserve_incomplete_session_answers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF OLD.is_completed THEN
        RETURN OLD;
    END IF;

    PERFORM set_config('app.session_delete_preserve_answers', 'on', true);

    UPDATE public.user_answers
    SET test_session_id = NULL
    WHERE test_session_id = OLD.id;

    PERFORM set_config('app.session_delete_preserve_answers', 'off', true);
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS preserve_incomplete_session_answers_trigger ON public.test_sessions;
CREATE TRIGGER preserve_incomplete_session_answers_trigger
    BEFORE DELETE ON public.test_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.preserve_incomplete_session_answers();

REVOKE ALL ON FUNCTION public.preserve_incomplete_session_answers() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preserve_incomplete_session_answers() FROM anon;
REVOKE ALL ON FUNCTION public.preserve_incomplete_session_answers() FROM authenticated;

COMMENT ON TABLE public.test_sessions IS
'Deleting an unfinished session removes its locked test_session_questions. Submitted answers are retained with test_session_id = NULL, so answered state/history survives while unanswered locks leave Suspended and become New. Trial usage is retained separately.';

COMMENT ON COLUMN public.user_answers.test_session_id IS
'Nullable only for retained answer history after an unfinished session is deleted; new submitted answers always require a live session.';
