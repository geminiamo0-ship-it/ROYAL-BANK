-- Fix Content Manager imports under pg-safeupdate and avoid rebuilding
-- bank_question_stats once per question in a bulk import.

CREATE OR REPLACE FUNCTION public.refresh_bank_question_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    -- pg-safeupdate blocks DELETE/UPDATE statements with no WHERE clause in
    -- PostgREST sessions. These are intentional whole-table refreshes, so keep
    -- an explicit predicate rather than a clause-less mutation.
    DELETE FROM public.bank_question_stats
    WHERE TRUE;

    INSERT INTO public.bank_question_stats(
        question_bank_id,
        category,
        topic,
        difficulty,
        total_questions,
        updated_at
    )
    SELECT
        qbq.question_bank_id,
        COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized'),
        COALESCE(q.topic, ''),
        COALESCE(q.difficulty, '1'),
        COUNT(*)::INTEGER,
        timezone('utc'::text, now())
    FROM public.question_bank_questions qbq
    JOIN public.questions q ON q.id = qbq.question_id
    WHERE COALESCE(q.difficulty, '1') IN ('1', '2', '3')
    GROUP BY
        qbq.question_bank_id,
        COALESCE(NULLIF(BTRIM(q.category), ''), 'Uncategorized'),
        COALESCE(q.topic, ''),
        COALESCE(q.difficulty, '1');

    UPDATE public.question_bank_dashboard_cache
    SET
        is_dirty = TRUE,
        updated_at = timezone('utc'::text, now())
    WHERE TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_bank_question_stats_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    -- Content Manager imports set this transaction-local flag so the legacy
    -- statement trigger does not rebuild the entire stats table once for every
    -- imported question. One final refresh is done after all batches finish.
    IF current_setting('royal.content_manager_bulk', TRUE) = '1' THEN
        RETURN NULL;
    END IF;

    PERFORM public.refresh_bank_question_stats();
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.content_manager_import_questions(
    p_bank_id BIGINT,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_row JSONB;
    v_opt JSONB;
    v_qid BIGINT;
    v_option_count INTEGER := 0;
    v_question_count INTEGER := 0;
    v_correct_count INTEGER;
BEGIN
    IF p_bank_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.question_banks WHERE id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_BANK_NOT_FOUND';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_QUESTION_PAYLOAD';
    END IF;

    IF jsonb_array_length(p_rows) > 200 THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_QUESTION_BATCH_TOO_LARGE';
    END IF;

    PERFORM set_config('royal.content_manager_bulk', '1', TRUE);

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        v_qid := NULLIF(v_row->>'id', '')::BIGINT;

        IF v_qid IS NULL
           OR COALESCE(btrim(v_row->>'text_html'), '') = ''
           OR COALESCE(btrim(v_row->>'explanation_html'), '') = ''
           OR COALESCE(btrim(v_row->>'category'), '') = '' THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_QUESTION';
        END IF;

        IF jsonb_typeof(COALESCE(v_row->'options', '[]'::jsonb)) <> 'array'
           OR jsonb_array_length(COALESCE(v_row->'options', '[]'::jsonb)) < 2 THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_OPTIONS_FOR_QUESTION_%', v_qid;
        END IF;

        SELECT COUNT(*)
        INTO v_correct_count
        FROM jsonb_array_elements(v_row->'options') option_row
        WHERE COALESCE((option_row->>'is_correct')::BOOLEAN, FALSE);

        IF v_correct_count <> 1 THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_CORRECT_OPTION_COUNT_%_%', v_qid, v_correct_count;
        END IF;

        INSERT INTO public.questions (
            id, main_id, text_html, explanation_html, category, topic, concept,
            concept_id, notes_id, difficulty, source, pm_question_id, concepts_json
        )
        VALUES (
            v_qid,
            NULLIF(v_row->>'main_id', '')::BIGINT,
            v_row->>'text_html',
            v_row->>'explanation_html',
            v_row->>'category',
            NULLIF(v_row->>'topic', ''),
            NULLIF(v_row->>'concept', ''),
            NULLIF(v_row->>'concept_id', ''),
            NULLIF(v_row->>'notes_id', ''),
            COALESCE(NULLIF(v_row->>'difficulty', ''), '1'),
            COALESCE(NULLIF(v_row->>'source', ''), 'PassMedicine'),
            NULLIF(v_row->>'pm_question_id', ''),
            NULLIF(v_row->>'concepts_json', '')
        )
        ON CONFLICT (id) DO UPDATE
        SET
            main_id = EXCLUDED.main_id,
            text_html = EXCLUDED.text_html,
            explanation_html = EXCLUDED.explanation_html,
            category = EXCLUDED.category,
            topic = EXCLUDED.topic,
            concept = EXCLUDED.concept,
            concept_id = EXCLUDED.concept_id,
            notes_id = EXCLUDED.notes_id,
            difficulty = EXCLUDED.difficulty,
            source = EXCLUDED.source,
            pm_question_id = EXCLUDED.pm_question_id,
            concepts_json = EXCLUDED.concepts_json;

        INSERT INTO public.question_bank_questions (question_bank_id, question_id)
        VALUES (p_bank_id, v_qid)
        ON CONFLICT (question_bank_id, question_id) DO NOTHING;

        UPDATE public.options
        SET is_correct = FALSE
        WHERE question_id = v_qid;

        FOR v_opt IN SELECT value FROM jsonb_array_elements(v_row->'options')
        LOOP
            IF NULLIF(v_opt->>'option_order', '') IS NULL
               OR COALESCE(btrim(v_opt->>'text_html'), '') = '' THEN
                RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_OPTION_FOR_QUESTION_%', v_qid;
            END IF;

            INSERT INTO public.options (
                question_id, text_html, is_correct, option_order, percentage
            )
            VALUES (
                v_qid,
                v_opt->>'text_html',
                COALESCE((v_opt->>'is_correct')::BOOLEAN, FALSE),
                (v_opt->>'option_order')::INTEGER,
                NULLIF(v_opt->>'percentage', '')::REAL
            )
            ON CONFLICT (question_id, option_order) DO UPDATE
            SET
                text_html = EXCLUDED.text_html,
                is_correct = EXCLUDED.is_correct,
                percentage = EXCLUDED.percentage;

            v_option_count := v_option_count + 1;
        END LOOP;

        BEGIN
            MERGE INTO public.options AS existing_option
            USING (
                SELECT
                    v_qid AS question_id,
                    (source_option->>'option_order')::INTEGER AS option_order
                FROM jsonb_array_elements(v_row->'options') source_option
            ) AS source_option
            ON existing_option.question_id = source_option.question_id
           AND existing_option.option_order = source_option.option_order
            WHEN NOT MATCHED BY SOURCE
                 AND existing_option.question_id = v_qid
            THEN DELETE;
        EXCEPTION
            WHEN foreign_key_violation THEN
                RAISE EXCEPTION 'CONTENT_MANAGER_STALE_OPTION_REFERENCED_%', v_qid;
        END;

        v_question_count := v_question_count + 1;
    END LOOP;

    PERFORM setval(
        pg_get_serial_sequence('public.questions', 'id'),
        GREATEST(
            (SELECT last_value FROM public.questions_id_seq),
            (SELECT COALESCE(MAX(id), 1) FROM public.questions)
        ),
        TRUE
    );

    RETURN jsonb_build_object(
        'bank_id', p_bank_id,
        'questions_processed', v_question_count,
        'options_processed', v_option_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.content_manager_refresh_counts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    PERFORM public.refresh_bank_question_stats();
    REFRESH MATERIALIZED VIEW public.question_bank_topic_counts;

    RETURN jsonb_build_object(
        'refreshed', TRUE,
        'refreshed_at', clock_timestamp()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.content_manager_refresh_counts()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_manager_import_questions(BIGINT, JSONB)
TO service_role;
GRANT EXECUTE ON FUNCTION public.content_manager_refresh_counts()
TO service_role;