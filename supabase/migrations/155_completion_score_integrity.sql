CREATE OR REPLACE FUNCTION public.enforce_test_session_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    locked_count BIGINT;
    correct_count BIGINT;
    expected_score REAL;
BEGIN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.question_bank_id IS DISTINCT FROM OLD.question_bank_id
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.session_type IS DISTINCT FROM OLD.session_type
       OR NEW.categories IS DISTINCT FROM OLD.categories
       OR NEW.difficulty_filter IS DISTINCT FROM OLD.difficulty_filter
       OR NEW.question_selection IS DISTINCT FROM OLD.question_selection
       OR NEW.time_limit_minutes IS DISTINCT FROM OLD.time_limit_minutes THEN
        RAISE EXCEPTION 'Exam configuration is immutable after session creation';
    END IF;

    IF OLD.is_completed THEN
        IF NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'Completed session is immutable';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.is_completed THEN
        SELECT COUNT(*) INTO locked_count
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = OLD.id;

        SELECT COUNT(*) FILTER (WHERE ua.is_correct) INTO correct_count
        FROM public.user_answers ua
        WHERE ua.test_session_id = OLD.id
          AND ua.user_id = OLD.user_id;

        IF locked_count < 1 OR locked_count > 70 THEN
            RAISE EXCEPTION 'Invalid locked question count';
        END IF;

        expected_score := ROUND((correct_count::NUMERIC / locked_count::NUMERIC * 100), 2)::REAL;
        NEW.total_questions := locked_count::INT;
        NEW.score_percentage := expected_score;
        NEW.completed_at := timezone('utc'::text, now());
    ELSE
        IF NEW.total_questions IS DISTINCT FROM OLD.total_questions THEN
            RAISE EXCEPTION 'Question count is immutable while session is active';
        END IF;
        IF NEW.completed_at IS NOT NULL OR NEW.score_percentage IS NOT NULL THEN
            RAISE EXCEPTION 'Active session cannot have final result fields';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
