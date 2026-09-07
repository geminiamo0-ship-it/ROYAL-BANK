CREATE OR REPLACE FUNCTION public.enforce_test_session_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.question_bank_id IS DISTINCT FROM OLD.question_bank_id
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.session_type IS DISTINCT FROM OLD.session_type
       OR NEW.categories IS DISTINCT FROM OLD.categories
       OR NEW.difficulty_filter IS DISTINCT FROM OLD.difficulty_filter
       OR NEW.question_selection IS DISTINCT FROM OLD.question_selection
       OR NEW.total_questions IS DISTINCT FROM OLD.total_questions
       OR NEW.time_limit_minutes IS DISTINCT FROM OLD.time_limit_minutes THEN
        RAISE EXCEPTION 'Exam configuration is immutable after session creation';
    END IF;

    IF OLD.is_completed AND NOT NEW.is_completed THEN
        RAISE EXCEPTION 'Completed sessions cannot be reopened';
    END IF;

    IF OLD.is_completed AND (
        NEW.completed_at IS DISTINCT FROM OLD.completed_at
        OR NEW.score_percentage IS DISTINCT FROM OLD.score_percentage
    ) THEN
        RAISE EXCEPTION 'Completed result is immutable';
    END IF;

    IF NOT NEW.is_completed AND NEW.score_percentage IS NOT NULL THEN
        RAISE EXCEPTION 'Score cannot be set before completion';
    END IF;

    IF NEW.is_completed AND NOT OLD.is_completed THEN
        NEW.completed_at := timezone('utc'::text, now());
    ELSEIF NOT NEW.is_completed THEN
        NEW.completed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;
