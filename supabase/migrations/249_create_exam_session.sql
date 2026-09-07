-- Canonical exam-session creation contract.
-- Selection is uniform random over the eligible question pool. Because each
-- question has equal probability, category representation is naturally
-- proportional to the available filtered pool rather than forced equal quotas.

ALTER TABLE public.question_banks
    ADD COLUMN IF NOT EXISTS free_trial_question_limit INT NOT NULL DEFAULT 70;

ALTER TABLE public.question_banks
    DROP CONSTRAINT IF EXISTS question_banks_free_trial_question_limit_check;
ALTER TABLE public.question_banks
    ADD CONSTRAINT question_banks_free_trial_question_limit_check
    CHECK (free_trial_question_limit BETWEEN 1 AND 70);

ALTER TABLE public.test_sessions
    ADD COLUMN IF NOT EXISTS topic_filters JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.create_exam_session(
    p_user_id UUID,
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INT,
    p_difficulties TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_topics JSONB DEFAULT '[]'::jsonb,
    p_question_selection TEXT DEFAULT 'new_only'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
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

    SELECT EXISTS (
        SELECT 1
        FROM public.question_banks qb
        JOIN public.user_pathway_access upa ON upa.pathway_id = qb.pathway_id
        WHERE qb.id = p_bank_id
          AND upa.user_id = p_user_id
          AND upa.access_type = 'premium'
          AND (upa.expires_at IS NULL OR upa.expires_at > now())
    ) OR public.is_support_or_admin()
    INTO has_premium;

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

REVOKE ALL ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INT, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INT, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INT, TEXT[], TEXT[], JSONB, TEXT
) IS
'Creates and locks an exam block atomically after access, quota, state and filter validation. Random selection is proportional to the eligible pool.';
