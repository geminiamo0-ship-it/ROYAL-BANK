-- Fast path for the most common Create selection shape:
--   question_selection = 'all' with no difficulty/category/topic filters.
--
-- In that case eligibility is fully represented by question_bank_questions, so
-- joining public.questions only to read q.id is redundant. Use the existing
-- (question_bank_id, shuffle_key, question_id) ring index directly and preserve the
-- same pivot/order/limit semantics. Filtered Create keeps the current query unchanged.

DO $migration$
DECLARE
    v_def text;
    v_open_old text := $old$
    IF p_question_selection = 'all' THEN
        SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.segment, chosen.shuffle_key, chosen.question_id)
$old$;
    v_open_new text := $new$
    IF p_question_selection = 'all' THEN
        IF COALESCE(cardinality(p_difficulties), 0) = 0
           AND COALESCE(cardinality(p_categories), 0) = 0
           AND jsonb_array_length(p_topics) = 0 THEN
            SELECT ARRAY_AGG(
                chosen.question_id
                ORDER BY chosen.segment, chosen.shuffle_key, chosen.question_id
            )
            INTO selected_question_ids
            FROM (
                SELECT *
                FROM (
                    (
                        SELECT
                            qbq.question_id,
                            qbq.shuffle_key,
                            0 AS segment
                        FROM public.question_bank_questions qbq
                        WHERE qbq.question_bank_id = p_bank_id
                          AND qbq.shuffle_key >= selection_pivot
                        ORDER BY qbq.shuffle_key, qbq.question_id
                        LIMIT effective_limit
                    )
                    UNION ALL
                    (
                        SELECT
                            qbq.question_id,
                            qbq.shuffle_key,
                            1 AS segment
                        FROM public.question_bank_questions qbq
                        WHERE qbq.question_bank_id = p_bank_id
                          AND qbq.shuffle_key < selection_pivot
                        ORDER BY qbq.shuffle_key, qbq.question_id
                        LIMIT effective_limit
                    )
                ) ring_candidates
                ORDER BY segment, shuffle_key, question_id
                LIMIT effective_limit
            ) chosen;
        ELSE
            SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.segment, chosen.shuffle_key, chosen.question_id)
$new$;
    v_close_old text := $old$
        ) chosen;

    ELSIF p_question_selection = 'flagged_only' THEN
$old$;
    v_close_new text := $new$
        ) chosen;
        END IF;

    ELSIF p_question_selection = 'flagged_only' THEN
$new$;
BEGIN
    SELECT pg_get_functiondef(
        'private.create_exam_session_bootstrap_core(bigint,text,integer,text[],text[],jsonb,text)'::regprocedure
    ) INTO v_def;

    IF position(v_open_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'CREATE_BOOTSTRAP_ALL_OPEN_BLOCK_CHANGED';
    END IF;
    IF position(v_open_old IN substr(v_def, position(v_open_old IN v_def) + length(v_open_old))) > 0 THEN
        RAISE EXCEPTION 'CREATE_BOOTSTRAP_ALL_OPEN_BLOCK_AMBIGUOUS';
    END IF;
    IF position(v_close_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'CREATE_BOOTSTRAP_ALL_CLOSE_BLOCK_CHANGED';
    END IF;
    IF position(v_close_old IN substr(v_def, position(v_close_old IN v_def) + length(v_close_old))) > 0 THEN
        RAISE EXCEPTION 'CREATE_BOOTSTRAP_ALL_CLOSE_BLOCK_AMBIGUOUS';
    END IF;

    v_def := replace(v_def, v_open_old, v_open_new);
    v_def := replace(v_def, v_close_old, v_close_new);
    EXECUTE v_def;
END;
$migration$;

COMMENT ON FUNCTION private.create_exam_session_bootstrap_core(
    bigint, text, integer, text[], text[], jsonb, text
) IS
    'Creates an exam bootstrap; all/no-filter selection uses question_bank_questions directly while filtered paths preserve question metadata joins.';
