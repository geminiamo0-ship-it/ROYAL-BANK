CREATE OR REPLACE FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[] DEFAULT ARRAY[]::"text"[], "p_categories" "text"[] DEFAULT ARRAY[]::"text"[], "p_topics" "jsonb" DEFAULT '[]'::"jsonb", "p_question_selection" "text" DEFAULT 'new_only'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    new_session_id UUID;
    selected_question_ids BIGINT[];
    selected_count INT;
    effective_limit INT;
    trial_question_limit INT;
    has_premium BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Account is inactive';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 70 THEN
        RAISE EXCEPTION 'Question limit must be between 1 and 70';
    END IF;

    IF p_session_type NOT IN (
        'standard', 'tutor', 'timed', 'fixed_timed', 'mock_exam', 'review', 'quick_champion'
    ) THEN
        RAISE EXCEPTION 'Invalid session type';
    END IF;

    IF p_question_selection NOT IN (
        'new_only', 'incorrect_only', 'all', 'flagged_only', 'suspended_only'
    ) THEN
        RAISE EXCEPTION 'Invalid question selection';
    END IF;

    IF p_topics IS NULL OR jsonb_typeof(p_topics) <> 'array' THEN
        RAISE EXCEPTION 'Topic filters must be a JSON array';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    has_premium := public.has_premium_question_bank_access(p_bank_id);

    SELECT qb.free_trial_question_limit
    INTO trial_question_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    effective_limit := LEAST(
        p_limit,
        CASE WHEN has_premium THEN 70 ELSE trial_question_limit END
    );

    SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
    INTO selected_question_ids
    FROM (
        SELECT
            q.id AS question_id,
            random() AS random_key
        FROM public.question_bank_questions qbq
        JOIN public.questions q ON q.id = qbq.question_id
        JOIN public.get_user_question_states(p_bank_id) state
          ON state.question_id = q.id
        WHERE qbq.question_bank_id = p_bank_id
          AND (
              COALESCE(cardinality(p_difficulties), 0) = 0
              OR q.difficulty = ANY(p_difficulties)
          )
          AND (
              (
                  COALESCE(cardinality(p_categories), 0) = 0
                  AND jsonb_array_length(p_topics) = 0
              )
              OR q.category = ANY(p_categories)
              OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(p_topics) AS topic_filter
                  WHERE topic_filter->>'category' = q.category
                    AND topic_filter->>'topic' = q.topic
              )
          )
          AND CASE p_question_selection
              WHEN 'new_only' THEN state.is_new
              WHEN 'incorrect_only' THEN state.answer_state = 'incorrect'
              WHEN 'flagged_only' THEN state.is_flagged
              WHEN 'suspended_only' THEN state.is_suspended
              WHEN 'all' THEN TRUE
              ELSE FALSE
          END
        ORDER BY random_key
        LIMIT effective_limit
    ) AS chosen;

    selected_count := COALESCE(cardinality(selected_question_ids), 0);
    IF selected_count = 0 THEN
        RAISE EXCEPTION 'No questions match the selected filters';
    END IF;

    INSERT INTO public.test_sessions (
        user_id,
        question_bank_id,
        session_type,
        categories,
        difficulty_filter,
        question_selection,
        topic_filters,
        total_questions,
        is_completed
    ) VALUES (
        p_user_id,
        p_bank_id,
        p_session_type,
        COALESCE(p_categories, ARRAY[]::TEXT[]),
        COALESCE(p_difficulties, ARRAY[]::TEXT[]),
        p_question_selection,
        p_topics,
        selected_count,
        FALSE
    )
    RETURNING id INTO new_session_id;

    INSERT INTO public.test_session_questions (
        test_session_id,
        question_id,
        sort_order
    )
    SELECT
        new_session_id,
        selected.question_id,
        selected.ordinality::INT - 1
    FROM unnest(selected_question_ids) WITH ORDINALITY AS selected(question_id, ordinality);

    RETURN new_session_id;
END;
$$;

ALTER FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") IS 'Creates and locks an exam block atomically after canonical scoped access, trial quota, state and filter validation. Scoped premium grants receive the normal 70-question ceiling.';

CREATE OR REPLACE FUNCTION "public"."enforce_answer_finalization"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    mode TEXT;
    completed BOOLEAN;
BEGIN
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

ALTER FUNCTION "public"."enforce_answer_finalization"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."enforce_answer_finalization"() IS 'Standard/Tutor: submitted answer rows are immutable. Timed modes: answer row may be updated until End Block; completed sessions make answers immutable.';

CREATE OR REPLACE FUNCTION "public"."enforce_free_trial_session_quota"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    trial_enabled BOOLEAN;
    block_limit INT;
    used_blocks BIGINT;
    has_premium BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Account is inactive';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.user_id::text || ':' || NEW.question_bank_id::text, 0)
    );

    SELECT qb.is_free_trial, qb.free_trial_block_limit
    INTO trial_enabled, block_limit
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    SELECT public.has_premium_question_bank_access(NEW.question_bank_id)
    INTO has_premium;

    IF has_premium THEN
        RETURN NEW;
    END IF;

    IF NOT trial_enabled THEN
        RAISE EXCEPTION 'Premium access required for this question bank';
    END IF;

    IF block_limit IS NULL THEN
        RAISE EXCEPTION 'Free-trial bank is missing a block limit';
    END IF;

    SELECT COUNT(*) INTO used_blocks
    FROM public.free_trial_block_usage usage_row
    WHERE usage_row.user_id = NEW.user_id
      AND usage_row.question_bank_id = NEW.question_bank_id;

    IF used_blocks >= block_limit THEN
        RAISE EXCEPTION 'Free-trial block quota exhausted';
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_free_trial_session_quota"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."enforce_free_trial_session_quota"() IS 'Enforces non-refundable free-trial block quota only when the authenticated user lacks active scoped premium access to the bank.';

CREATE OR REPLACE FUNCTION "public"."enforce_test_session_update_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
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

ALTER FUNCTION "public"."enforce_test_session_update_integrity"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) RETURNS TABLE("category" "text", "topic" "text", "total_questions" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF p_bank_id = 1 THEN
    -- Legacy Bank 1 behavior; superseded by later bank-aware RPC migrations.
    RETURN QUERY
    SELECT q.category, q.topic, COUNT(*) as total_questions
    FROM questions q
    WHERE q.category IS NOT NULL
    GROUP BY q.category, q.topic;
  ELSE
    RETURN QUERY
    SELECT q.category, q.topic, COUNT(*) as total_questions
    FROM question_bank_questions qbq
    JOIN questions q ON q.id = qbq.question_id
    WHERE qbq.question_bank_id = p_bank_id
      AND q.category IS NOT NULL
    GROUP BY q.category, q.topic;
  END IF;
END;
$$;

ALTER FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    result JSON;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id::BIGINT) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    INTO result
    FROM (
        SELECT category, topic, total_questions
        FROM public.question_bank_topic_counts
        WHERE question_bank_id = p_bank_id
        ORDER BY category, topic NULLS FIRST
    ) t;

    RETURN result;
END;
$$;

ALTER FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) IS 'Returns bank-aware aggregate category/topic counts only after authoritative bank access check.';

CREATE OR REPLACE FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    session_row public.test_sessions;
    answer_row public.user_answers;
    correct_option_id BIGINT;
    explanation TEXT;
    percentages JSONB;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO session_row
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF NOT public.can_access_question_bank(session_row.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = p_session_id
          AND tsq.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'Question does not belong to session';
    END IF;

    SELECT * INTO answer_row
    FROM public.user_answers ua
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
      AND ua.question_id = p_question_id;

    IF answer_row.id IS NULL THEN
        RAISE EXCEPTION 'Question has not been answered';
    END IF;

    IF NOT session_row.is_completed
       AND session_row.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Feedback is unavailable until End Block';
    END IF;

    SELECT o.id INTO correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT q.explanation_html INTO explanation
    FROM public.questions q
    WHERE q.id = p_question_id;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    )
    INTO percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', answer_row.selected_option_id,
        'is_correct', answer_row.is_correct,
        'correct_option_id', correct_option_id,
        'explanation_html', explanation,
        'option_percentages', percentages
    );
END;
$$;

ALTER FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) IS 'Returns answer key, explanation and option percentages only after a Standard/Tutor submission is final or after End Block for mutable modes.';

CREATE OR REPLACE FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") RETURNS TABLE("question_id" bigint, "selected_option_id" bigint, "is_correct" boolean, "correct_option_id" bigint, "time_spent_seconds" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    session_row public.test_sessions;
    reveal_correctness BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO session_row
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF NOT public.can_access_question_bank(session_row.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    reveal_correctness := session_row.is_completed
        OR session_row.session_type IN ('standard', 'tutor');

    RETURN QUERY
    SELECT
        ua.question_id,
        ua.selected_option_id,
        CASE WHEN reveal_correctness THEN ua.is_correct ELSE NULL END,
        CASE WHEN reveal_correctness THEN correct_option.id ELSE NULL END,
        ua.time_spent_seconds
    FROM public.user_answers ua
    LEFT JOIN LATERAL (
        SELECT o.id
        FROM public.options o
        WHERE o.question_id = ua.question_id
          AND o.is_correct = TRUE
        ORDER BY o.id
        LIMIT 1
    ) correct_option ON TRUE
    WHERE ua.test_session_id = p_session_id
      AND ua.user_id = auth.uid()
    ORDER BY ua.answered_at, ua.id;
END;
$$;

ALTER FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") OWNER TO "postgres";
