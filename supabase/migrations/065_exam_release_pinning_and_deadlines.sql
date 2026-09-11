-- Session-wide content consistency and authoritative timed-session deadline enforcement.
--
-- The immutable R2 release is paired with a small private Postgres answer-key snapshot.
-- Sessions pin exactly one ready release. Browser roles cannot register or mutate releases.
-- Timed/fixed_timed answer writes are accepted or rejected from the server clock only.

ALTER TABLE public.test_sessions
    ADD COLUMN IF NOT EXISTS content_release_id text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'test_sessions_content_release_id_format'
          AND conrelid = 'public.test_sessions'::regclass
    ) THEN
        ALTER TABLE public.test_sessions
            ADD CONSTRAINT test_sessions_content_release_id_format
            CHECK (content_release_id IS NULL OR content_release_id ~ '^[0-9a-f]{64}$');
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS private.exam_content_releases (
    release_id text PRIMARY KEY CHECK (release_id ~ '^[0-9a-f]{64}$'),
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    question_count integer NOT NULL CHECK (question_count >= 0),
    option_count integer NOT NULL CHECK (option_count >= 0),
    is_ready boolean NOT NULL DEFAULT false,
    registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finalized_at timestamptz
);

CREATE TABLE IF NOT EXISTS private.exam_content_release_answers (
    release_id text NOT NULL REFERENCES private.exam_content_releases(release_id) ON DELETE RESTRICT,
    question_id bigint NOT NULL,
    correct_option_id bigint NOT NULL,
    option_ids bigint[] NOT NULL,
    option_percentages jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (release_id, question_id),
    CONSTRAINT exam_content_release_answers_nonempty_options CHECK (cardinality(option_ids) > 0),
    CONSTRAINT exam_content_release_answers_correct_member CHECK (correct_option_id = ANY(option_ids)),
    CONSTRAINT exam_content_release_answers_percentages_object CHECK (jsonb_typeof(option_percentages) = 'object')
);

CREATE INDEX IF NOT EXISTS exam_content_release_answers_question_idx
    ON private.exam_content_release_answers(question_id, release_id);

REVOKE ALL ON TABLE private.exam_content_releases FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE private.exam_content_release_answers FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_release_id(p_release_id text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
    IF p_release_id IS NULL OR p_release_id !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'INVALID_CONTENT_RELEASE_ID';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.assert_release_id(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_exam_content_release(
    p_release_id text,
    p_manifest_sha256 text,
    p_question_count integer,
    p_option_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_existing private.exam_content_releases;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;
    PERFORM private.assert_release_id(p_release_id);
    IF p_manifest_sha256 IS NULL OR p_manifest_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'INVALID_MANIFEST_SHA256';
    END IF;
    IF p_question_count IS NULL OR p_question_count < 0
       OR p_option_count IS NULL OR p_option_count < 0 THEN
        RAISE EXCEPTION 'INVALID_CONTENT_RELEASE_COUNTS';
    END IF;

    SELECT * INTO v_existing
    FROM private.exam_content_releases r
    WHERE r.release_id = p_release_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.manifest_sha256 IS DISTINCT FROM p_manifest_sha256
           OR v_existing.question_count IS DISTINCT FROM p_question_count
           OR v_existing.option_count IS DISTINCT FROM p_option_count THEN
            RAISE EXCEPTION 'IMMUTABLE_CONTENT_RELEASE_MISMATCH';
        END IF;
        RETURN;
    END IF;

    INSERT INTO private.exam_content_releases(
        release_id, manifest_sha256, question_count, option_count
    ) VALUES (
        p_release_id, p_manifest_sha256, p_question_count, p_option_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_exam_content_release_answers(
    p_release_id text,
    p_answers jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_release private.exam_content_releases;
    v_item jsonb;
    v_question_id bigint;
    v_correct_option_id bigint;
    v_option_ids bigint[];
    v_percentages jsonb;
    v_existing private.exam_content_release_answers;
    v_count integer := 0;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;
    PERFORM private.assert_release_id(p_release_id);
    IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
        RAISE EXCEPTION 'INVALID_CONTENT_RELEASE_ANSWERS';
    END IF;

    SELECT * INTO v_release
    FROM private.exam_content_releases r
    WHERE r.release_id = p_release_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONTENT_RELEASE_NOT_REGISTERED';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_answers)
    LOOP
        v_question_id := NULLIF(v_item->>'question_id', '')::bigint;
        v_correct_option_id := NULLIF(v_item->>'correct_option_id', '')::bigint;
        v_percentages := COALESCE(v_item->'option_percentages', '{}'::jsonb);
        SELECT COALESCE(array_agg(value::bigint ORDER BY ordinality), ARRAY[]::bigint[])
        INTO v_option_ids
        FROM jsonb_array_elements_text(COALESCE(v_item->'option_ids', '[]'::jsonb))
             WITH ORDINALITY AS ids(value, ordinality);

        IF v_question_id IS NULL OR v_question_id <= 0
           OR v_correct_option_id IS NULL OR v_correct_option_id <= 0
           OR cardinality(v_option_ids) < 1
           OR NOT (v_correct_option_id = ANY(v_option_ids))
           OR jsonb_typeof(v_percentages) <> 'object' THEN
            RAISE EXCEPTION 'INVALID_CONTENT_RELEASE_ANSWER';
        END IF;

        SELECT * INTO v_existing
        FROM private.exam_content_release_answers a
        WHERE a.release_id = p_release_id
          AND a.question_id = v_question_id;

        IF FOUND THEN
            IF v_existing.correct_option_id IS DISTINCT FROM v_correct_option_id
               OR v_existing.option_ids IS DISTINCT FROM v_option_ids
               OR v_existing.option_percentages IS DISTINCT FROM v_percentages THEN
                RAISE EXCEPTION 'IMMUTABLE_CONTENT_RELEASE_ANSWER_MISMATCH';
            END IF;
        ELSE
            IF v_release.is_ready THEN
                RAISE EXCEPTION 'CONTENT_RELEASE_ALREADY_FINALIZED';
            END IF;
            INSERT INTO private.exam_content_release_answers(
                release_id, question_id, correct_option_id, option_ids, option_percentages
            ) VALUES (
                p_release_id, v_question_id, v_correct_option_id, v_option_ids, v_percentages
            );
        END IF;
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_exam_content_release(p_release_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_release private.exam_content_releases;
    v_answer_count integer;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;
    PERFORM private.assert_release_id(p_release_id);

    SELECT * INTO v_release
    FROM private.exam_content_releases r
    WHERE r.release_id = p_release_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CONTENT_RELEASE_NOT_REGISTERED';
    END IF;

    SELECT count(*) INTO v_answer_count
    FROM private.exam_content_release_answers a
    WHERE a.release_id = p_release_id;

    IF v_answer_count <> v_release.question_count THEN
        RAISE EXCEPTION 'CONTENT_RELEASE_INCOMPLETE';
    END IF;

    UPDATE private.exam_content_releases
    SET is_ready = true,
        finalized_at = COALESCE(finalized_at, clock_timestamp())
    WHERE release_id = p_release_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_exam_content_release(text, text, integer, integer)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_exam_content_release_answers(text, jsonb)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_exam_content_release(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_exam_content_release(text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_exam_content_release_answers(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_exam_content_release(text) TO service_role;

CREATE OR REPLACE FUNCTION private.pin_exam_session_content_release(
    p_session_id uuid,
    p_requested_release_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.content_release_id IS NOT NULL THEN
        RETURN v_session.content_release_id;
    END IF;
    IF p_requested_release_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM private.assert_release_id(p_requested_release_id);
    IF NOT EXISTS (
        SELECT 1
        FROM private.exam_content_releases r
        WHERE r.release_id = p_requested_release_id
          AND r.is_ready = true
    ) THEN
        RAISE EXCEPTION 'CONTENT_RELEASE_NOT_READY';
    END IF;

    UPDATE public.test_sessions
    SET content_release_id = p_requested_release_id
    WHERE id = p_session_id
      AND user_id = auth.uid()
      AND content_release_id IS NULL
    RETURNING * INTO v_session;

    IF v_session.id IS NULL THEN
        SELECT * INTO v_session
        FROM public.test_sessions ts
        WHERE ts.id = p_session_id
          AND ts.user_id = auth.uid();
    END IF;
    RETURN v_session.content_release_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.pin_exam_session_content_release(uuid, text)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.augment_exam_bootstrap_release(
    p_payload jsonb,
    p_requested_release_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session_id uuid;
    v_release_id text;
BEGIN
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RETURN p_payload;
    END IF;
    v_session_id := NULLIF(p_payload->'session'->>'id', '')::uuid;
    IF v_session_id IS NULL THEN
        RETURN p_payload;
    END IF;

    v_release_id := private.pin_exam_session_content_release(
        v_session_id,
        p_requested_release_id
    );
    RETURN jsonb_set(
        p_payload,
        '{session,content_release_id}',
        COALESCE(to_jsonb(v_release_id), 'null'::jsonb),
        true
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.augment_exam_bootstrap_release(jsonb, text)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_exam_session_bootstrap_idempotent_v3(
    p_request_id uuid,
    p_bank_id bigint,
    p_session_type text,
    p_limit integer,
    p_difficulties text[] DEFAULT ARRAY[]::text[],
    p_categories text[] DEFAULT ARRAY[]::text[],
    p_topics jsonb DEFAULT '[]'::jsonb,
    p_question_selection text DEFAULT 'new_only'::text,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    RETURN private.augment_exam_bootstrap_release(
        public.create_exam_session_bootstrap_idempotent_v2(
            p_request_id, p_bank_id, p_session_type, p_limit,
            p_difficulties, p_categories, p_topics, p_question_selection
        ),
        p_content_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_v3(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    RETURN private.augment_exam_bootstrap_release(
        public.get_exam_session_bootstrap_v2(p_session_id),
        p_content_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_bootstrap_ref_v3(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    RETURN private.augment_exam_bootstrap_release(
        public.get_exam_session_bootstrap_ref_v2(p_session_id),
        p_content_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(
    p_session_id uuid,
    p_content_release_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
BEGIN
    RETURN private.augment_exam_bootstrap_release(
        public.get_completed_exam_review_bootstrap_ref(p_session_id),
        p_content_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_session_window_refs_v2(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_refs jsonb;
    v_release_id text;
BEGIN
    v_refs := public.get_exam_session_window_refs(p_session_id, p_start, p_count);
    SELECT ts.content_release_id INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id AND ts.user_id = auth.uid();
    RETURN jsonb_build_object('content_release_id', v_release_id, 'questions', v_refs);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_window_refs_v2(
    p_session_id uuid,
    p_start integer DEFAULT 0,
    p_count integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_refs jsonb;
    v_release_id text;
BEGIN
    v_refs := public.get_completed_exam_review_window_refs(p_session_id, p_start, p_count);
    SELECT ts.content_release_id INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id AND ts.user_id = auth.uid();
    RETURN jsonb_build_object('content_release_id', v_release_id, 'questions', v_refs);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_question_feedback_ref_v2(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_payload jsonb;
    v_release_id text;
BEGIN
    v_payload := public.get_exam_question_feedback_ref(p_session_id, p_question_id);
    SELECT ts.content_release_id INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id AND ts.user_id = auth.uid();
    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', v_payload->'selected_option_id',
        'is_correct', v_payload->'is_correct',
        'content_release_id', v_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_exam_training_feedback_ref_v2(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_payload jsonb;
    v_release_id text;
BEGIN
    v_payload := public.get_exam_training_feedback_ref(p_session_id, p_question_id);
    SELECT ts.content_release_id INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id AND ts.user_id = auth.uid();
    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'content_release_id', v_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_completed_exam_review_feedback_ref_v2(
    p_session_id uuid,
    p_question_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_payload jsonb;
    v_release_id text;
BEGIN
    v_payload := public.get_completed_exam_review_feedback(p_session_id, p_question_id);
    SELECT ts.content_release_id INTO v_release_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id AND ts.user_id = auth.uid();
    RETURN jsonb_build_object(
        'question_id', p_question_id,
        'selected_option_id', v_payload->'selected_option_id',
        'is_correct', v_payload->'is_correct',
        'content_release_id', v_release_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_exam_answer_with_feedback_ref_idempotent_v2(
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
    v_answer jsonb;
    v_feedback jsonb;
BEGIN
    v_answer := private.submit_exam_answer_idempotent_core(
        p_request_id, p_session_id, p_question_id,
        p_selected_option_id, p_time_spent_seconds
    );
    v_feedback := public.get_exam_question_feedback_ref_v2(p_session_id, p_question_id);
    RETURN jsonb_build_object('answer', v_answer, 'feedback', v_feedback);
END;
$function$;

-- Pinned sessions derive correctness from the immutable release snapshot.
CREATE OR REPLACE FUNCTION public.validate_user_answer_relationships()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_option_is_correct boolean;
    v_correct_option_id bigint;
    v_option_ids bigint[];
    v_trusted_timed_finalization boolean := false;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Answer user does not match authenticated user';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = NEW.test_session_id
      AND ts.user_id = NEW.user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Answer session does not belong to user';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.test_session_questions tsq
        WHERE tsq.test_session_id = NEW.test_session_id
          AND tsq.question_id = NEW.question_id
    ) THEN
        RAISE EXCEPTION 'Question does not belong to test session';
    END IF;

    v_trusted_timed_finalization :=
        v_session.session_type IN ('timed', 'fixed_timed')
        AND EXISTS (
            SELECT 1
            FROM private.exam_timed_finalization_context ctx
            WHERE ctx.transaction_id = txid_current()
              AND ctx.user_id = NEW.user_id
              AND ctx.session_id = NEW.test_session_id
        );

    IF NEW.selected_option_id IS NULL THEN
        IF NOT v_trusted_timed_finalization THEN
            RAISE EXCEPTION 'Submitted answer requires a selected option';
        END IF;
        NEW.is_correct := false;
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM private.question_disclosures d
        WHERE d.user_id = NEW.user_id
          AND d.question_id = NEW.question_id
    ) THEN
        RAISE EXCEPTION 'QUESTION_NOT_DISCLOSED';
    END IF;

    IF v_session.content_release_id IS NOT NULL THEN
        SELECT a.correct_option_id, a.option_ids
        INTO v_correct_option_id, v_option_ids
        FROM private.exam_content_release_answers a
        JOIN private.exam_content_releases r ON r.release_id = a.release_id
        WHERE a.release_id = v_session.content_release_id
          AND a.question_id = NEW.question_id
          AND r.is_ready = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'SESSION_CONTENT_RELEASE_INCOMPLETE';
        END IF;
        IF NOT (NEW.selected_option_id = ANY(v_option_ids)) THEN
            RAISE EXCEPTION 'Selected option does not belong to pinned question';
        END IF;
        NEW.is_correct := NEW.selected_option_id = v_correct_option_id;
    ELSE
        SELECT o.is_correct INTO v_option_is_correct
        FROM public.options o
        WHERE o.id = NEW.selected_option_id
          AND o.question_id = NEW.question_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected option does not belong to question';
        END IF;
        NEW.is_correct := v_option_is_correct;
    END IF;

    RETURN NEW;
END;
$function$;

-- Re-lock the authoritative session row and reject new timed writes after the deadline.
-- Idempotent ACK replays still succeed because the idempotency core returns a stored
-- response before invoking this function again.
CREATE OR REPLACE FUNCTION public.submit_exam_answer(
    p_session_id uuid,
    p_question_id bigint,
    p_selected_option_id bigint,
    p_time_spent_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_result public.user_answers;
    v_reveal_correctness boolean;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;
    IF p_time_spent_seconds < 0 THEN
        RAISE EXCEPTION 'time_spent_seconds cannot be negative';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_session.is_completed, false) THEN
        RAISE EXCEPTION 'Active session not found';
    END IF;
    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF v_session.session_type IN ('timed', 'fixed_timed')
       AND v_session.time_limit_minutes IS NOT NULL
       AND clock_timestamp() >= v_session.started_at + make_interval(mins => v_session.time_limit_minutes) THEN
        RAISE EXCEPTION 'EXAM_DEADLINE_EXPIRED';
    END IF;

    IF v_session.session_type IN ('standard', 'tutor') THEN
        INSERT INTO public.user_answers(
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        RETURNING * INTO v_result;
    ELSE
        INSERT INTO public.user_answers(
            test_session_id, user_id, question_id, selected_option_id, time_spent_seconds
        ) VALUES (
            p_session_id, auth.uid(), p_question_id, p_selected_option_id, p_time_spent_seconds
        )
        ON CONFLICT (test_session_id, question_id)
        DO UPDATE SET
            selected_option_id = EXCLUDED.selected_option_id,
            time_spent_seconds = EXCLUDED.time_spent_seconds
        RETURNING * INTO v_result;
    END IF;

    v_reveal_correctness := v_session.session_type IN ('standard', 'tutor');
    RETURN jsonb_build_object(
        'question_id', v_result.question_id,
        'selected_option_id', v_result.selected_option_id,
        'time_spent_seconds', v_result.time_spent_seconds,
        'is_correct', CASE WHEN v_reveal_correctness THEN v_result.is_correct ELSE NULL END
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.renew_exam_window_access(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_session public.test_sessions;
    v_question_ids jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;
    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id AND ts.user_id = auth.uid();
    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;
    IF COALESCE(v_session.is_completed, false) THEN
        IF NOT public.can_read_locked_session(p_session_id) THEN
            RAISE EXCEPTION 'Question bank access denied';
        END IF;
    ELSIF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;
    SELECT COALESCE(jsonb_agg(tsq.question_id ORDER BY tsq.sort_order), '[]'::jsonb)
    INTO v_question_ids
    FROM public.test_session_questions tsq
    WHERE tsq.test_session_id = p_session_id;
    RETURN jsonb_build_object(
        'session', jsonb_build_object(
            'id', v_session.id,
            'is_completed', COALESCE(v_session.is_completed, false),
            'content_release_id', v_session.content_release_id
        ),
        'question_ids', v_question_ids,
        'content_release_id', v_session.content_release_id
    );
END;
$function$;

-- Every browser-callable exam surface, including the new versioned/ref wrappers,
-- must pass through the Royal POST-only BFF proof check.
CREATE OR REPLACE FUNCTION api_hooks.royal_exam_pre_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    v_cfg private.exam_gateway_config%ROWTYPE;
    v_path text := NULLIF(current_setting('request.path', true), '');
    v_method text := UPPER(COALESCE(NULLIF(current_setting('request.method', true), ''), ''));
    v_headers jsonb := COALESCE(NULLIF(current_setting('request.headers', true), ''), '{}')::jsonb;
    v_rpc_name text;
    v_key_id text;
    v_key text;
BEGIN
    PERFORM set_config('request.royal_gateway_verified', '0', true);
    SELECT * INTO v_cfg FROM private.exam_gateway_config WHERE singleton = true;
    IF NOT FOUND OR NOT v_cfg.enforcement_enabled THEN RETURN; END IF;

    v_rpc_name := substring(COALESCE(v_path, '') FROM '/rpc/([^/?]+)$');
    IF v_rpc_name IS NULL OR v_rpc_name <> ALL (ARRAY[
        'create_exam_session','get_exam_session_answers',
        'create_exam_session_bootstrap','create_exam_session_bootstrap_idempotent',
        'create_exam_session_bootstrap_idempotent_v2','create_exam_session_bootstrap_idempotent_v3',
        'get_exam_session_bootstrap','get_exam_session_bootstrap_v2','get_exam_session_bootstrap_v3',
        'get_exam_session_bootstrap_ref','get_exam_session_bootstrap_ref_v2','get_exam_session_bootstrap_ref_v3',
        'get_exam_session_window','get_exam_session_window_refs','get_exam_session_window_refs_v2',
        'get_completed_exam_review_bootstrap','get_completed_exam_review_bootstrap_ref','get_completed_exam_review_bootstrap_ref_v2',
        'get_completed_exam_review_window','get_completed_exam_review_window_refs','get_completed_exam_review_window_refs_v2',
        'get_completed_exam_review_feedback','get_completed_exam_review_feedback_ref_v2',
        'submit_exam_answer','submit_exam_answer_idempotent',
        'submit_exam_answer_with_feedback','submit_exam_answer_with_feedback_idempotent',
        'submit_exam_answer_with_feedback_ref_idempotent','submit_exam_answer_with_feedback_ref_idempotent_v2',
        'get_exam_question_feedback','get_exam_question_feedback_ref','get_exam_question_feedback_ref_v2',
        'get_exam_training_feedback','get_exam_training_feedback_ref','get_exam_training_feedback_ref_v2',
        'renew_exam_window_access','set_question_flag','complete_exam_session',
        'record_exam_gateway_rate_limit_rejection'
    ]::text[]) THEN
        RETURN;
    END IF;

    IF v_method <> 'POST' THEN
        RAISE SQLSTATE 'PT405' USING MESSAGE = 'Protected exam RPCs require POST';
    END IF;
    v_key_id := NULLIF(v_headers->>'x-royal-gateway-key-id', '');
    v_key := NULLIF(v_headers->>'x-royal-gateway-key', '');
    IF v_key_id IS NULL OR v_key IS NULL
       OR NOT private.is_valid_exam_gateway_key(v_key_id, v_key, clock_timestamp()) THEN
        RAISE SQLSTATE 'PT403' USING MESSAGE = 'Exam gateway required';
    END IF;
    PERFORM set_config('request.royal_gateway_verified', '1', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_exam_session_bootstrap_idempotent_v3(
    uuid, bigint, text, integer, text[], text[], jsonb, text, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_bootstrap_ref_v3(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_session_window_refs_v2(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_window_refs_v2(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_question_feedback_ref_v2(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_exam_training_feedback_ref_v2(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_completed_exam_review_feedback_ref_v2(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_exam_answer_with_feedback_ref_idempotent_v2(uuid, uuid, bigint, bigint, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_exam_session_bootstrap_idempotent_v3(
    uuid, bigint, text, integer, text[], text[], jsonb, text, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_v3(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_bootstrap_ref_v3(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_bootstrap_ref_v2(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_session_window_refs_v2(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_window_refs_v2(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_question_feedback_ref_v2(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_training_feedback_ref_v2(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_exam_review_feedback_ref_v2(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_exam_answer_with_feedback_ref_idempotent_v2(uuid, uuid, bigint, bigint, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION api_hooks.royal_exam_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_hooks.royal_exam_pre_request()
    TO anon, authenticated, service_role, authenticator;

COMMENT ON COLUMN public.test_sessions.content_release_id IS
    'Immutable R2/content answer-key release pinned once for the lifetime of an exam session.';
