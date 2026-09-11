-- Correctness foundation for exam answer writes and instant training feedback.
--
-- Goals:
--   1. Serialize answer writes with End Block on the same test_sessions row.
--   2. Make client retries safe with a stable request id.
--   3. Expose pre-answer feedback only for active Standard/Tutor sessions.
--   4. Keep the R2 feedback path read-only after a successful mutation.

CREATE TABLE IF NOT EXISTS private.exam_answer_idempotency (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    session_id uuid NOT NULL REFERENCES public.test_sessions(id) ON DELETE CASCADE,
    question_id bigint NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    request_payload jsonb NOT NULL,
    response_payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, request_id)
);

REVOKE ALL ON TABLE private.exam_answer_idempotency FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS exam_answer_idempotency_session_created_idx
    ON private.exam_answer_idempotency (session_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.submit_exam_answer(
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    mode text;
    completed boolean;
    bank_id bigint;
    result public.user_answers;
    reveal_correctness boolean;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_time_spent_seconds < 0 THEN
        RAISE EXCEPTION 'time_spent_seconds cannot be negative';
    END IF;

    -- complete_exam_session() locks this same row. Whichever operation gets the
    -- lock first wins, so End Block cannot calculate a result while an allowed
    -- answer is concurrently being committed, and no answer can slip in after
    -- completion.
    SELECT ts.session_type, ts.is_completed, ts.question_bank_id
    INTO mode, completed, bank_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND OR completed THEN
        RAISE EXCEPTION 'Active session not found';
    END IF;

    IF NOT public.can_access_question_bank(bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF mode IN ('standard', 'tutor') THEN
        INSERT INTO public.user_answers (
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        RETURNING * INTO result;
    ELSE
        INSERT INTO public.user_answers (
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        ON CONFLICT (test_session_id, question_id)
        DO UPDATE SET
            selected_option_id = EXCLUDED.selected_option_id,
            time_spent_seconds = EXCLUDED.time_spent_seconds
        RETURNING * INTO result;
    END IF;

    reveal_correctness := mode IN ('standard', 'tutor');

    RETURN jsonb_build_object(
        'question_id', result.question_id,
        'selected_option_id', result.selected_option_id,
        'time_spent_seconds', result.time_spent_seconds,
        'is_correct', CASE WHEN reveal_correctness THEN result.is_correct ELSE NULL END
    );
END;
$function$;

CREATE OR REPLACE FUNCTION private.submit_exam_answer_idempotent_core(
    p_request_id uuid,
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_request_payload jsonb;
    v_existing private.exam_answer_idempotency%ROWTYPE;
    v_response jsonb;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;
    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    -- Serialize duplicate transport retries for the same user/request id. This
    -- is deliberately independent from the session row lock used for End Block.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'royal:exam-answer-idempotency:' || v_user_id::text || ':' || p_request_id::text,
            0
        )
    );

    v_request_payload := jsonb_build_object(
        'session_id', p_session_id,
        'question_id', p_question_id,
        'selected_option_id', p_selected_option_id,
        'time_spent_seconds', p_time_spent_seconds
    );

    SELECT * INTO v_existing
    FROM private.exam_answer_idempotency idem
    WHERE idem.user_id = v_user_id
      AND idem.request_id = p_request_id;

    IF FOUND THEN
        IF v_existing.request_payload IS DISTINCT FROM v_request_payload THEN
            RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED';
        END IF;
        RETURN v_existing.response_payload;
    END IF;

    v_response := public.submit_exam_answer(
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );

    INSERT INTO private.exam_answer_idempotency (
        user_id,
        request_id,
        session_id,
        question_id,
        request_payload,
        response_payload
    ) VALUES (
        v_user_id,
        p_request_id,
        p_session_id,
        p_question_id,
        v_request_payload,
        v_response
    );

    RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION private.submit_exam_answer_idempotent_core(uuid, uuid, bigint, bigint, integer)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_exam_answer_idempotent(
    p_request_id uuid,
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
    SELECT private.submit_exam_answer_idempotent_core(
        p_request_id,
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );
$function$;

CREATE OR REPLACE FUNCTION public.submit_exam_answer_with_feedback_idempotent(
    p_request_id uuid,
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    answer_payload jsonb;
    feedback_payload jsonb;
BEGIN
    answer_payload := private.submit_exam_answer_idempotent_core(
        p_request_id,
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );

    feedback_payload := public.get_exam_question_feedback(
        p_session_id,
        p_question_id
    );

    RETURN jsonb_build_object(
        'answer', answer_payload,
        'feedback', feedback_payload
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_exam_answer_with_feedback_ref_idempotent(
    p_request_id uuid,
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    answer_payload jsonb;
    feedback_payload jsonb;
BEGIN
    answer_payload := private.submit_exam_answer_idempotent_core(
        p_request_id,
        p_session_id,
        p_question_id,
        p_selected_option_id,
        p_time_spent_seconds
    );

    feedback_payload := public.get_exam_question_feedback_ref(
        p_session_id,
        p_question_id
    );

    RETURN jsonb_build_object(
        'answer', answer_payload,
        'feedback', feedback_payload
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_training_feedback(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_correct_option_id bigint;
    v_explanation text;
    v_percentages jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;
    IF v_session.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Training feedback is unavailable for this session type';
    END IF;
    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
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
    IF NOT EXISTS (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = auth.uid()
          AND d.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    SELECT o.id INTO v_correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT q.explanation_html INTO v_explanation
    FROM public.questions q
    WHERE q.id = p_question_id;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    ) INTO v_percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'correct_option_id', v_correct_option_id,
        'explanation_html', v_explanation,
        'option_percentages', v_percentages
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_training_feedback_ref(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_correct_option_id bigint;
    v_percentages jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;
    IF v_session.session_type NOT IN ('standard', 'tutor') THEN
        RAISE EXCEPTION 'Training feedback is unavailable for this session type';
    END IF;
    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
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
    IF NOT EXISTS (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = auth.uid()
          AND d.question_id = p_question_id
    ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    SELECT o.id INTO v_correct_option_id
    FROM public.options o
    WHERE o.question_id = p_question_id
      AND o.is_correct = TRUE
    ORDER BY o.id
    LIMIT 1;

    SELECT COALESCE(
        jsonb_object_agg(o.id::text, COALESCE(o.percentage, 0) ORDER BY o.option_order, o.id),
        '{}'::jsonb
    ) INTO v_percentages
    FROM public.options o
    WHERE o.question_id = p_question_id;

    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'correct_option_id', v_correct_option_id,
        'option_percentages', v_percentages
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_exam_answer_idempotent(uuid, uuid, bigint, bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_exam_answer_with_feedback_idempotent(uuid, uuid, bigint, bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_exam_answer_with_feedback_ref_idempotent(uuid, uuid, bigint, bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_training_feedback(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_training_feedback_ref(uuid, bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_exam_answer_idempotent(uuid, uuid, bigint, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback_idempotent(uuid, uuid, bigint, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback_ref_idempotent(uuid, uuid, bigint, bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exam_training_feedback(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_exam_training_feedback_ref(uuid, bigint) TO authenticated;
