


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'ROYAL-BANK core security baseline: role-gated privileged operations, bank-gated question content, persistent question flags, canonical question-state RPC, server-derived answer correctness, and database-enforced free-trial quota.';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."question_banks" (
    "id" bigint NOT NULL,
    "pathway_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "is_free_trial" boolean DEFAULT false NOT NULL,
    "free_trial_block_limit" integer,
    "free_trial_question_limit" integer DEFAULT 70 NOT NULL,
    CONSTRAINT "question_banks_free_trial_block_limit_check" CHECK ((("free_trial_block_limit" IS NULL) OR ("free_trial_block_limit" >= 0))),
    CONSTRAINT "question_banks_free_trial_question_limit_check" CHECK ((("free_trial_question_limit" >= 1) AND ("free_trial_question_limit" <= 70))),
    CONSTRAINT "question_banks_trial_config_check" CHECK (((("is_free_trial" = false) AND ("free_trial_block_limit" IS NULL)) OR (("is_free_trial" = true) AND ("free_trial_block_limit" IS NOT NULL) AND ("free_trial_block_limit" >= 0))))
);

ALTER TABLE ONLY "public"."question_banks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_banks" OWNER TO "postgres";


COMMENT ON TABLE "public"."question_banks" IS 'Authenticated active users may read bank metadata so locked banks can appear in navigation; question mappings/content/options remain access-gated.';



COMMENT ON COLUMN "public"."question_banks"."is_free_trial" IS 'Per-bank free-trial switch. Each pathway may have zero, one, or multiple trial banks according to product configuration.';



COMMENT ON COLUMN "public"."question_banks"."free_trial_block_limit" IS 'Lifetime trial block quota. Zero means the bank is configured as trial-visible but no new trial blocks may be created; positive values allow that many blocks.';



CREATE OR REPLACE FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer DEFAULT NULL::integer) RETURNS "public"."question_banks"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    bank_row public.question_banks;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    IF p_is_free_trial AND p_free_trial_block_limit IS NULL THEN
        RAISE EXCEPTION 'Free-trial banks require a block limit';
    END IF;

    IF p_free_trial_block_limit IS NOT NULL AND p_free_trial_block_limit < 0 THEN
        RAISE EXCEPTION 'Free-trial block limit cannot be negative';
    END IF;

    IF p_is_free_trial AND NOT EXISTS (
        SELECT 1 FROM public.question_bank_questions qbq WHERE qbq.question_bank_id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'Cannot enable trial on a bank with no mapped questions';
    END IF;

    UPDATE public.question_banks
    SET
        is_free_trial = p_is_free_trial,
        free_trial_block_limit = CASE WHEN p_is_free_trial THEN p_free_trial_block_limit ELSE NULL END
    WHERE id = p_bank_id
    RETURNING * INTO bank_row;

    IF bank_row.id IS NULL THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    RETURN bank_row;
END;
$$;


ALTER FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) IS 'Authenticated admin-only configuration boundary. Trusted ingestion/maintenance may use Supabase service role, which bypasses RLS by design and must remain server-only.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text" NOT NULL,
    "avatar_url" "text",
    "role" "text" DEFAULT 'student'::"text" NOT NULL,
    "subscription_tier" "text" DEFAULT 'free_trial'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_login_at" timestamp with time zone,
    "last_login_ip" "inet",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['student'::"text", 'admin'::"text", 'support'::"text"]))),
    CONSTRAINT "profiles_subscription_tier_check" CHECK (("subscription_tier" = ANY (ARRAY['free_trial'::"text", 'premium_individual'::"text", 'premium_full'::"text"])))
);

ALTER TABLE ONLY "public"."profiles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."email" IS 'Authentication identity email. Not mutable through profile self-service RPC; email changes must flow through Supabase Auth and an explicit sync path.';



COMMENT ON COLUMN "public"."profiles"."role" IS 'Authorization role used by server route guards and database helpers. Values: student, admin, support. New signups are always student.';



COMMENT ON COLUMN "public"."profiles"."subscription_tier" IS 'UI/account summary only. Authoritative premium content access is user_pathway_access plus per-bank free-trial configuration; do not authorize question content from this field alone.';



COMMENT ON COLUMN "public"."profiles"."is_active" IS 'Privileged account-status field. Inactive accounts are denied protected data access by RLS/helpers.';



CREATE OR REPLACE FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text" DEFAULT NULL::"text", "p_subscription_tier" "text" DEFAULT NULL::"text", "p_is_active" boolean DEFAULT NULL::boolean) RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    updated_profile public.profiles;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    IF p_role IS NOT NULL AND p_role NOT IN ('student', 'admin', 'support') THEN
        RAISE EXCEPTION 'Invalid role';
    END IF;

    IF p_subscription_tier IS NOT NULL
       AND p_subscription_tier NOT IN ('free_trial', 'premium_individual', 'premium_full') THEN
        RAISE EXCEPTION 'Invalid subscription tier';
    END IF;

    IF p_user_id = auth.uid() AND (p_role IS NOT NULL AND p_role <> 'admin' OR p_is_active = FALSE) THEN
        RAISE EXCEPTION 'Admin cannot demote or deactivate the current account';
    END IF;

    UPDATE public.profiles
    SET
        role = COALESCE(p_role, role),
        subscription_tier = COALESCE(p_subscription_tier, subscription_tier),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_user_id
    RETURNING * INTO updated_profile;

    IF updated_profile.id IS NULL THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    RETURN updated_profile;
END;
$$;


ALTER FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_bank_access_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF OLD.is_free_trial IS DISTINCT FROM NEW.is_free_trial
       OR OLD.free_trial_block_limit IS DISTINCT FROM NEW.free_trial_block_limit THEN
        INSERT INTO public.bank_access_audit (
            question_bank_id, changed_by, is_free_trial, free_trial_block_limit
        ) VALUES (
            NEW.id, auth.uid(), NEW.is_free_trial, NEW.free_trial_block_limit
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_bank_access_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_pathway_access_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    INSERT INTO public.pathway_access_audit (
        user_id, pathway_id, changed_by, access_type, blocks_allowed, expires_at
    ) VALUES (
        NEW.user_id, NEW.pathway_id, auth.uid(), NEW.access_type, NEW.blocks_allowed, NEW.expires_at
    );
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_pathway_access_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_profile_access_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF OLD.role IS DISTINCT FROM NEW.role
       OR OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier
       OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        INSERT INTO public.profile_access_audit (
            user_id, changed_by, role, subscription_tier, is_active
        ) VALUES (
            NEW.id, auth.uid(), NEW.role, NEW.subscription_tier, NEW.is_active
        );
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."audit_profile_access_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_question"("p_question_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.question_bank_questions qbq
        WHERE qbq.question_id = p_question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    );
$$;


ALTER FUNCTION "public"."can_access_question"("p_question_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND (
            public.has_premium_question_bank_access(p_bank_id)
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                WHERE qb.id = p_bank_id
                  AND qb.is_free_trial = TRUE
            )
        );
$$;


ALTER FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) IS 'Content access check. Trial quota exhaustion blocks NEW session creation but does not revoke access to existing trial-bank content/session review.';



CREATE OR REPLACE FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.test_sessions ts
        WHERE ts.id = p_session_id
          AND ts.user_id = auth.uid()
          AND public.can_access_question_bank(ts.question_bank_id)
    );
$$;


ALTER FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."test_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "question_bank_id" bigint,
    "session_type" "text" DEFAULT 'standard'::"text",
    "categories" "text"[],
    "difficulty_filter" "text"[],
    "question_selection" "text" DEFAULT 'new_only'::"text",
    "total_questions" integer DEFAULT 0,
    "time_limit_minutes" integer,
    "started_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "completed_at" timestamp with time zone,
    "score_percentage" real,
    "is_completed" boolean DEFAULT false,
    "topic_filters" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "test_sessions_difficulty_filter_check" CHECK ((("difficulty_filter" IS NULL) OR ("difficulty_filter" <@ ARRAY['1'::"text", '2'::"text", '3'::"text"]))),
    CONSTRAINT "test_sessions_question_selection_check" CHECK (("question_selection" = ANY (ARRAY['new_only'::"text", 'incorrect_only'::"text", 'all'::"text", 'flagged_only'::"text", 'suspended_only'::"text"]))),
    CONSTRAINT "test_sessions_score_percentage_range" CHECK ((("score_percentage" IS NULL) OR (("score_percentage" >= (0)::double precision) AND ("score_percentage" <= (100)::double precision)))),
    CONSTRAINT "test_sessions_session_type_check" CHECK (("session_type" = ANY (ARRAY['standard'::"text", 'tutor'::"text", 'timed'::"text", 'fixed_timed'::"text", 'mock_exam'::"text", 'review'::"text", 'quick_champion'::"text"]))),
    CONSTRAINT "test_sessions_time_limit_positive" CHECK ((("time_limit_minutes" IS NULL) OR ("time_limit_minutes" > 0))),
    CONSTRAINT "test_sessions_total_questions_range" CHECK ((("total_questions" >= 0) AND ("total_questions" <= 70)))
);

ALTER TABLE ONLY "public"."test_sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."test_sessions" IS 'Completed sessions are immutable history and cannot be deleted by students. Incomplete sessions may be deleted by their active owner even after bank access expires; cascading answers/locks are removed while trial consumption remains.';



COMMENT ON COLUMN "public"."test_sessions"."total_questions" IS 'Locked block size, constrained to at most 70 and reconciled against test_session_questions at End Block.';



COMMENT ON COLUMN "public"."test_sessions"."score_percentage" IS 'Derived exam result. Should be set by trusted completion logic, not treated as client-authoritative data.';



COMMENT ON COLUMN "public"."test_sessions"."is_completed" IS 'Completion transition is validated database-side; application should use complete_exam_session(id) for End Block.';



CREATE OR REPLACE FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") RETURNS "public"."test_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    result public.test_sessions;
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
        PERFORM set_config('app.timed_finalization', 'on', true);

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

        PERFORM set_config('app.timed_finalization', 'off', true);
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


ALTER FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") IS 'Authoritative End Block operation: computes score from persisted answers and finalizes the session.';



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


CREATE OR REPLACE FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") RETURNS TABLE("category" "text", "total_answered" bigint, "correct_count" bigint, "accuracy_percentage" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF auth.uid() <> p_user_id AND NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    WITH latest AS (
        SELECT DISTINCT ON (ua.question_id)
            ua.question_id,
            ua.is_correct
        FROM public.user_answers ua
        JOIN public.test_sessions answer_session
          ON answer_session.id = ua.test_session_id
        WHERE ua.user_id = p_user_id
          AND (
              answer_session.is_completed = TRUE
              OR answer_session.session_type IN ('standard', 'tutor')
          )
        ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
    )
    SELECT
        q.category,
        COUNT(*) AS total_answered,
        COUNT(*) FILTER (WHERE latest.is_correct) AS correct_count,
        ROUND(
            COUNT(*) FILTER (WHERE latest.is_correct)::NUMERIC
            / NULLIF(COUNT(*), 0) * 100,
            1
        ) AS accuracy_percentage
    FROM latest
    JOIN public.questions q ON q.id = latest.question_id
    GROUP BY q.category
    ORDER BY total_answered DESC;
END;
$$;


ALTER FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) RETURNS TABLE("question_id" bigint, "answer_state" "text", "is_suspended" boolean, "is_flagged" boolean, "is_new" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    RETURN QUERY
    WITH bank_questions AS (
        SELECT qbq.question_id
        FROM public.question_bank_questions qbq
        WHERE qbq.question_bank_id = p_bank_id
    ),
    finalized_latest AS (
        SELECT DISTINCT ON (ua.question_id)
            ua.question_id,
            ua.is_correct
        FROM public.user_answers ua
        JOIN public.test_sessions answer_session
          ON answer_session.id = ua.test_session_id
        WHERE ua.user_id = auth.uid()
          AND (
              answer_session.is_completed = TRUE
              OR answer_session.session_type IN ('standard', 'tutor')
          )
        ORDER BY ua.question_id, ua.answered_at DESC, ua.id DESC
    ),
    suspended AS (
        SELECT DISTINCT tsq.question_id
        FROM public.test_session_questions tsq
        JOIN public.test_sessions ts ON ts.id = tsq.test_session_id
        LEFT JOIN public.user_answers ua
          ON ua.test_session_id = ts.id
         AND ua.question_id = tsq.question_id
         AND ua.user_id = auth.uid()
        WHERE ts.user_id = auth.uid()
          AND ts.question_bank_id = p_bank_id
          AND ts.is_completed = FALSE
          AND ua.id IS NULL
    ),
    active_locked AS (
        SELECT DISTINCT tsq.question_id
        FROM public.test_session_questions tsq
        JOIN public.test_sessions ts ON ts.id = tsq.test_session_id
        WHERE ts.user_id = auth.uid()
          AND ts.question_bank_id = p_bank_id
          AND ts.is_completed = FALSE
    ),
    flags AS (
        SELECT uqf.question_id
        FROM public.user_question_flags uqf
        WHERE uqf.user_id = auth.uid()
    )
    SELECT
        bq.question_id,
        CASE
            WHEN finalized_latest.question_id IS NULL THEN NULL
            WHEN finalized_latest.is_correct THEN 'correct'
            ELSE 'incorrect'
        END,
        suspended.question_id IS NOT NULL,
        flags.question_id IS NOT NULL,
        finalized_latest.question_id IS NULL AND active_locked.question_id IS NULL
    FROM bank_questions bq
    LEFT JOIN finalized_latest ON finalized_latest.question_id = bq.question_id
    LEFT JOIN suspended ON suspended.question_id = bq.question_id
    LEFT JOIN active_locked ON active_locked.question_id = bq.question_id
    LEFT JOIN flags ON flags.question_id = bq.question_id;
END;
$$;


ALTER FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) IS 'Application boundary for New/Correct/Incorrect/Suspended/Flagged state. Prefer this over rebuilding state from raw user_answers/test_session_questions in application code.';



CREATE TABLE IF NOT EXISTS "public"."user_access_grants" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "scope_type" "text" NOT NULL,
    "pathway_id" bigint,
    "question_bank_id" bigint,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "granted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_access_grants_expiry_check" CHECK ((("expires_at" IS NULL) OR ("expires_at" > "starts_at"))),
    CONSTRAINT "user_access_grants_scope_shape" CHECK (((("scope_type" = 'global'::"text") AND ("pathway_id" IS NULL) AND ("question_bank_id" IS NULL)) OR (("scope_type" = 'pathway'::"text") AND ("pathway_id" IS NOT NULL) AND ("question_bank_id" IS NULL)) OR (("scope_type" = 'bank'::"text") AND ("pathway_id" IS NULL) AND ("question_bank_id" IS NOT NULL)))),
    CONSTRAINT "user_access_grants_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['global'::"text", 'pathway'::"text", 'bank'::"text"])))
);

ALTER TABLE ONLY "public"."user_access_grants" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_access_grants" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_access_grants" IS 'Authoritative scoped premium access. global covers all banks; pathway includes present/future banks in that pathway; bank covers one bank. expires_at NULL means lifetime.';



CREATE OR REPLACE FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint DEFAULT NULL::bigint, "p_bank_id" bigint DEFAULT NULL::bigint, "p_starts_at" timestamp with time zone DEFAULT "now"(), "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."user_access_grants"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    result public.user_access_grants;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF p_scope_type NOT IN ('global', 'pathway', 'bank') THEN
        RAISE EXCEPTION 'Invalid access scope';
    END IF;

    IF p_starts_at IS NULL THEN
        RAISE EXCEPTION 'starts_at is required';
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= p_starts_at THEN
        RAISE EXCEPTION 'expires_at must be after starts_at';
    END IF;

    IF p_scope_type = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Global access cannot specify a pathway or bank';
        END IF;
    ELSIF p_scope_type = 'pathway' THEN
        IF p_pathway_id IS NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pathway access requires pathway_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'Pathway not found';
        END IF;
    ELSE
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL THEN
            RAISE EXCEPTION 'Bank access requires bank_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
            RAISE EXCEPTION 'Question bank not found';
        END IF;
    END IF;

    INSERT INTO public.user_access_grants (
        user_id,
        scope_type,
        pathway_id,
        question_bank_id,
        starts_at,
        expires_at,
        granted_by
    ) VALUES (
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id,
        p_starts_at,
        p_expires_at,
        auth.uid()
    )
    RETURNING * INTO result;

    RETURN result;
END;
$$;


ALTER FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_pathway_access" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "pathway_id" bigint,
    "access_type" "text" DEFAULT 'free_trial'::"text",
    "blocks_allowed" integer DEFAULT 1,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "expires_at" timestamp with time zone,
    CONSTRAINT "user_pathway_access_access_type_check" CHECK (("access_type" = ANY (ARRAY['free_trial'::"text", 'premium'::"text"]))),
    CONSTRAINT "user_pathway_access_blocks_allowed_nonnegative" CHECK (("blocks_allowed" >= 0))
);

ALTER TABLE ONLY "public"."user_pathway_access" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_pathway_access" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_pathway_access" IS 'Authoritative pathway subscription grants. Premium rows unlock all banks in the pathway until expiry; free-trial bank availability/quota is configured separately per question bank.';



CREATE OR REPLACE FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer DEFAULT 1, "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."user_pathway_access"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    access_row public.user_pathway_access;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    IF p_access_type NOT IN ('free_trial', 'premium') THEN
        RAISE EXCEPTION 'Invalid access type';
    END IF;

    IF p_blocks_allowed < 0 THEN
        RAISE EXCEPTION 'blocks_allowed cannot be negative';
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
        RAISE EXCEPTION 'Expiry must be in the future';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
        RAISE EXCEPTION 'Pathway not found';
    END IF;

    INSERT INTO public.user_pathway_access (
        user_id, pathway_id, access_type, blocks_allowed, granted_by, granted_at, expires_at
    ) VALUES (
        p_user_id, p_pathway_id, p_access_type, p_blocks_allowed, auth.uid(), timezone('utc'::text, now()), p_expires_at
    )
    ON CONFLICT (user_id, pathway_id)
    DO UPDATE SET
        access_type = EXCLUDED.access_type,
        blocks_allowed = EXCLUDED.blocks_allowed,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at,
        expires_at = EXCLUDED.expires_at
    RETURNING * INTO access_row;

    RETURN access_row;
END;
$$;


ALTER FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, subscription_tier)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        'student',
        'free_trial'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND (
            public.is_support_or_admin()
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_access_grants grant_row
                  ON grant_row.user_id = auth.uid()
                 AND grant_row.starts_at <= now()
                 AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
                 AND (
                     grant_row.scope_type = 'global'
                     OR (
                         grant_row.scope_type = 'pathway'
                         AND grant_row.pathway_id = qb.pathway_id
                     )
                     OR (
                         grant_row.scope_type = 'bank'
                         AND grant_row.question_bank_id = qb.id
                     )
                 )
                WHERE qb.id = p_bank_id
            )
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_pathway_access upa
                  ON upa.pathway_id = qb.pathway_id
                WHERE qb.id = p_bank_id
                  AND upa.user_id = auth.uid()
                  AND upa.access_type = 'premium'
                  AND (upa.expires_at IS NULL OR upa.expires_at > now())
            )
        );
$$;


ALTER FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND is_active = TRUE
    );
$$;


ALTER FUNCTION "public"."is_active_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
          AND is_active = TRUE
    );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_ip_blocked"("client_ip" "inet") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.ip_blocklist
        WHERE ip_address = client_ip
    );
END;
$$;


ALTER FUNCTION "public"."is_ip_blocked"("client_ip" "inet") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_support_or_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'support')
          AND is_active = TRUE
    );
$$;


ALTER FUNCTION "public"."is_support_or_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_support_or_admin"() IS 'Active staff authorization helper. Support/admin may inspect access and grant pathway subscriptions; only admin may change roles/account status or bank trial configuration.';



CREATE OR REPLACE FUNCTION "public"."record_free_trial_session_usage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    is_trial BOOLEAN;
    has_premium BOOLEAN;
BEGIN
    SELECT qb.is_free_trial
    INTO is_trial
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    SELECT public.has_premium_question_bank_access(NEW.question_bank_id)
    INTO has_premium;

    IF is_trial AND NOT has_premium THEN
        INSERT INTO public.free_trial_block_usage (
            user_id,
            question_bank_id,
            test_session_id
        )
        VALUES (
            NEW.user_id,
            NEW.question_bank_id,
            NEW.id
        )
        ON CONFLICT (test_session_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."record_free_trial_session_usage"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_free_trial_session_usage"() IS 'Records a trial-block ledger entry only for non-premium users; scoped premium users never consume trial quota.';



CREATE OR REPLACE FUNCTION "public"."refresh_question_bank_counts"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    REFRESH MATERIALIZED VIEW CONCURRENTLY public.question_bank_topic_counts;
END;
$$;


ALTER FUNCTION "public"."refresh_question_bank_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."require_test_session_bank"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    IF NEW.question_bank_id IS NULL THEN
        RAISE EXCEPTION 'Exam session requires a question bank';
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."require_test_session_bank"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    DELETE FROM public.user_access_grants
    WHERE id = p_grant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access grant not found';
    END IF;
END;
$$;


ALTER FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_answer_server_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.answered_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_answer_server_timestamp"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_answer_server_timestamp"() IS 'Runs after answer finalization/integrity guards by trigger-name order and stamps accepted answer selection writes.';



CREATE OR REPLACE FUNCTION "public"."set_ip_block_actor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Admin access required';
        END IF;
        NEW.blocked_by := auth.uid();
    END IF;
    NEW.blocked_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_ip_block_actor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_login_history_time"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
    NEW.login_at := timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_login_history_time"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_questions qbq
        WHERE qbq.question_id = p_question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    ) THEN
        RAISE EXCEPTION 'Question access denied';
    END IF;

    IF p_flagged THEN
        INSERT INTO public.user_question_flags (user_id, question_id)
        VALUES (auth.uid(), p_question_id)
        ON CONFLICT (user_id, question_id) DO NOTHING;
    ELSE
        DELETE FROM public.user_question_flags
        WHERE user_id = auth.uid()
          AND question_id = p_question_id;
    END IF;

    RETURN p_flagged;
END;
$$;


ALTER FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    mode TEXT;
    completed BOOLEAN;
    bank_id BIGINT;
    result public.user_answers;
    reveal_correctness BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_time_spent_seconds < 0 THEN
        RAISE EXCEPTION 'time_spent_seconds cannot be negative';
    END IF;

    SELECT ts.session_type, ts.is_completed, ts.question_bank_id
    INTO mode, completed, bank_id
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = auth.uid();

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
$$;


ALTER FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_my_profile"("p_full_name" "text" DEFAULT NULL::"text", "p_avatar_url" "text" DEFAULT NULL::"text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    updated_profile public.profiles;
    clean_name TEXT;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    clean_name := CASE WHEN p_full_name IS NULL THEN NULL ELSE btrim(p_full_name) END;

    IF clean_name IS NOT NULL AND (char_length(clean_name) < 1 OR char_length(clean_name) > 120) THEN
        RAISE EXCEPTION 'Full name must be between 1 and 120 characters';
    END IF;

    UPDATE public.profiles
    SET
        full_name = COALESCE(clean_name, full_name),
        avatar_url = COALESCE(p_avatar_url, avatar_url),
        updated_at = timezone('utc'::text, now())
    WHERE id = auth.uid()
    RETURNING * INTO updated_profile;

    RETURN updated_profile;
END;
$$;


ALTER FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_user_answer_relationships"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
DECLARE
    option_is_correct BOOLEAN;
    trusted_timed_finalization BOOLEAN :=
        COALESCE(current_setting('app.timed_finalization', true), '') = 'on';
BEGIN
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


ALTER FUNCTION "public"."validate_user_answer_relationships"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_user_question_write_access"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "row_security" TO 'off'
    AS $$
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.question_id IS DISTINCT FROM OLD.question_id
    ) THEN
        RAISE EXCEPTION 'User and question are immutable';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.question_bank_questions qbq
        WHERE qbq.question_id = NEW.question_id
          AND public.can_access_question_bank(qbq.question_bank_id)
    ) THEN
        RAISE EXCEPTION 'Question access denied';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_user_question_write_access"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_access_audit" (
    "id" bigint NOT NULL,
    "question_bank_id" bigint NOT NULL,
    "changed_by" "uuid",
    "is_free_trial" boolean NOT NULL,
    "free_trial_block_limit" integer,
    "changed_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."bank_access_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_access_audit" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."bank_access_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."bank_access_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."bank_access_audit_id_seq" OWNED BY "public"."bank_access_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."blocks" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "question_bank_id" bigint,
    "max_questions" integer DEFAULT 70,
    "is_free" boolean DEFAULT false,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "blocks_max_questions_range" CHECK ((("max_questions" >= 1) AND ("max_questions" <= 70)))
);

ALTER TABLE ONLY "public"."blocks" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."blocks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."blocks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."blocks_id_seq" OWNED BY "public"."blocks"."id";



CREATE TABLE IF NOT EXISTS "public"."free_trial_block_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "question_bank_id" bigint NOT NULL,
    "test_session_id" "uuid",
    "consumed_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."free_trial_block_usage" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."free_trial_block_usage" OWNER TO "postgres";


COMMENT ON TABLE "public"."free_trial_block_usage" IS 'Immutable lifetime trial-block consumption ledger. Deleting or terminating an exam session does not refund the consumed free-trial block.';



COMMENT ON COLUMN "public"."free_trial_block_usage"."user_id" IS 'Owner of trial consumption. Current pre-production schema cascades on profile deletion; define production retention policy before launch.';



CREATE SEQUENCE IF NOT EXISTS "public"."free_trial_block_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."free_trial_block_usage_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."free_trial_block_usage_id_seq" OWNED BY "public"."free_trial_block_usage"."id";



CREATE TABLE IF NOT EXISTS "public"."ip_blocklist" (
    "id" bigint NOT NULL,
    "ip_address" "inet" NOT NULL,
    "reason" "text",
    "blocked_by" "uuid",
    "blocked_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."ip_blocklist" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."ip_blocklist" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ip_blocklist_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ip_blocklist_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ip_blocklist_id_seq" OWNED BY "public"."ip_blocklist"."id";



CREATE TABLE IF NOT EXISTS "public"."library_articles" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "content_html" "text" NOT NULL,
    "source" "text" DEFAULT 'Pastest'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."library_articles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."library_articles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."login_history" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "ip_address" "inet",
    "user_agent" "text",
    "login_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "is_suspicious" boolean DEFAULT false
);

ALTER TABLE ONLY "public"."login_history" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."login_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."login_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."login_history_id_seq" OWNED BY "public"."login_history"."id";



CREATE TABLE IF NOT EXISTS "public"."options" (
    "id" bigint NOT NULL,
    "question_id" bigint NOT NULL,
    "text_html" "text" NOT NULL,
    "is_correct" boolean DEFAULT false NOT NULL,
    "option_order" integer DEFAULT 0 NOT NULL,
    "percentage" real DEFAULT 0.0,
    CONSTRAINT "options_order_nonnegative" CHECK (("option_order" >= 0)),
    CONSTRAINT "options_percentage_range" CHECK ((("percentage" >= (0)::double precision) AND ("percentage" <= (100)::double precision))),
    CONSTRAINT "options_text_nonempty" CHECK (("btrim"("text_html") <> ''::"text"))
);

ALTER TABLE ONLY "public"."options" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."options" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."options_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."options_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."options_id_seq" OWNED BY "public"."options"."id";



CREATE TABLE IF NOT EXISTS "public"."pathway_access_audit" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "pathway_id" bigint NOT NULL,
    "changed_by" "uuid",
    "access_type" "text" NOT NULL,
    "blocks_allowed" integer NOT NULL,
    "expires_at" timestamp with time zone,
    "changed_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."pathway_access_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pathway_access_audit" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pathway_access_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pathway_access_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pathway_access_audit_id_seq" OWNED BY "public"."pathway_access_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."pathways" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "icon_url" "text",
    "is_free_trial_available" boolean DEFAULT true,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."pathways" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."pathways" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pathways"."is_free_trial_available" IS 'Legacy pathway-level hint. Authoritative free-trial configuration is per question_banks.is_free_trial and free_trial_block_limit.';



CREATE SEQUENCE IF NOT EXISTS "public"."pathways_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pathways_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pathways_id_seq" OWNED BY "public"."pathways"."id";



CREATE TABLE IF NOT EXISTS "public"."profile_access_audit" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "changed_by" "uuid",
    "role" "text" NOT NULL,
    "subscription_tier" "text" NOT NULL,
    "is_active" boolean NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."profile_access_audit" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_access_audit" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."profile_access_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."profile_access_audit_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."profile_access_audit_id_seq" OWNED BY "public"."profile_access_audit"."id";



CREATE TABLE IF NOT EXISTS "public"."question_bank_questions" (
    "id" bigint NOT NULL,
    "question_bank_id" bigint NOT NULL,
    "question_id" bigint NOT NULL
);

ALTER TABLE ONLY "public"."question_bank_questions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_bank_questions" OWNER TO "postgres";


COMMENT ON TABLE "public"."question_bank_questions" IS 'After bulk mapping changes, call admin-only refresh_question_bank_counts() once to refresh shared category/topic counts.';



CREATE SEQUENCE IF NOT EXISTS "public"."question_bank_questions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."question_bank_questions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."question_bank_questions_id_seq" OWNED BY "public"."question_bank_questions"."id";



CREATE TABLE IF NOT EXISTS "public"."questions" (
    "id" bigint NOT NULL,
    "main_id" bigint,
    "text_html" "text" NOT NULL,
    "explanation_html" "text" NOT NULL,
    "category" "text" NOT NULL,
    "topic" "text",
    "concept" "text",
    "concept_id" "text",
    "notes_id" "text",
    "difficulty" "text" DEFAULT '1'::"text",
    "source" "text" DEFAULT 'PassMedicine'::"text",
    "pm_question_id" "text",
    "concepts_json" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "questions_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['1'::"text", '2'::"text", '3'::"text"]))),
    CONSTRAINT "questions_explanation_nonempty" CHECK (("btrim"("explanation_html") <> ''::"text")),
    CONSTRAINT "questions_text_nonempty" CHECK (("btrim"("text_html") <> ''::"text"))
);

ALTER TABLE ONLY "public"."questions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."questions" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."question_bank_topic_counts" AS
 SELECT "qbq"."question_bank_id",
    "q"."category",
    "q"."topic",
    "count"(*) AS "total_questions"
   FROM ("public"."question_bank_questions" "qbq"
     JOIN "public"."questions" "q" ON (("q"."id" = "qbq"."question_id")))
  WHERE ("q"."category" IS NOT NULL)
  GROUP BY "qbq"."question_bank_id", "q"."category", "q"."topic"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."question_bank_topic_counts" OWNER TO "postgres";


COMMENT ON MATERIALIZED VIEW "public"."question_bank_topic_counts" IS 'Bank-aware shared category/topic counts. Refresh with admin-only refresh_question_bank_counts() after question ingestion or bank mapping changes.';



CREATE SEQUENCE IF NOT EXISTS "public"."question_banks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."question_banks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."question_banks_id_seq" OWNED BY "public"."question_banks"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."questions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."questions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."questions_id_seq" OWNED BY "public"."questions"."id";



CREATE TABLE IF NOT EXISTS "public"."saved_concepts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "question_id" bigint NOT NULL,
    "concept_text" "text" NOT NULL,
    "is_important" boolean DEFAULT true NOT NULL,
    "saved_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."saved_concepts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_concepts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."saved_concepts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."saved_concepts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."saved_concepts_id_seq" OWNED BY "public"."saved_concepts"."id";



CREATE TABLE IF NOT EXISTS "public"."test_session_questions" (
    "test_session_id" "uuid" NOT NULL,
    "question_id" bigint NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."test_session_questions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_session_questions" OWNER TO "postgres";


COMMENT ON TABLE "public"."test_session_questions" IS 'Locked exam question set. Authenticated clients have read-only RLS access; writes are reserved for trusted session-creation database functions.';



CREATE SEQUENCE IF NOT EXISTS "public"."user_access_grants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_access_grants_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_access_grants_id_seq" OWNED BY "public"."user_access_grants"."id";



CREATE TABLE IF NOT EXISTS "public"."user_answers" (
    "id" bigint NOT NULL,
    "test_session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "question_id" bigint NOT NULL,
    "selected_option_id" bigint,
    "is_correct" boolean DEFAULT false NOT NULL,
    "is_flagged" boolean DEFAULT false,
    "time_spent_seconds" integer DEFAULT 0 NOT NULL,
    "answered_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "user_answers_time_spent_nonnegative" CHECK (("time_spent_seconds" >= 0))
);

ALTER TABLE ONLY "public"."user_answers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_answers" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_answers" IS 'Exam answer history. Application writes should use submit_exam_answer(); direct table policies remain temporarily for compatibility during application migration.';



COMMENT ON COLUMN "public"."user_answers"."selected_option_id" IS 'Nullable only for legacy/unanswered compatibility. New finalized answer writes should include a selected option; database derives correctness from it.';



COMMENT ON COLUMN "public"."user_answers"."is_correct" IS 'Derived database-side from selected_option_id by validate_user_answer_relationships; client value is not authoritative.';



COMMENT ON COLUMN "public"."user_answers"."is_flagged" IS 'Legacy snapshot only. Current persistent flag state lives in public.user_question_flags.';



COMMENT ON COLUMN "public"."user_answers"."time_spent_seconds" IS 'Client-measured duration, constrained non-negative; mutable only while the answer itself remains editable.';



COMMENT ON COLUMN "public"."user_answers"."answered_at" IS 'Server-stamped when an answer selection is persisted/changed. Latest answered_at (then id) determines current Correct/Incorrect state across sessions.';



CREATE SEQUENCE IF NOT EXISTS "public"."user_answers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_answers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_answers_id_seq" OWNED BY "public"."user_answers"."id";



CREATE OR REPLACE VIEW "public"."user_latest_answer_state" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("user_id", "question_id") "user_id",
    "question_id",
    "test_session_id",
    "selected_option_id",
    "is_correct",
    "time_spent_seconds",
    "answered_at"
   FROM "public"."user_answers" "ua"
  ORDER BY "user_id", "question_id", "answered_at" DESC, "id" DESC;


ALTER VIEW "public"."user_latest_answer_state" OWNER TO "postgres";


COMMENT ON VIEW "public"."user_latest_answer_state" IS 'Internal latest-answer projection. Client access is intentionally revoked; use get_user_question_states/get_exam_session_answers/get_exam_question_feedback.';



CREATE TABLE IF NOT EXISTS "public"."user_notes" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "question_id" bigint NOT NULL,
    "note_html" "text" NOT NULL,
    "highlights_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."user_notes" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_notes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_notes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_notes_id_seq" OWNED BY "public"."user_notes"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."user_pathway_access_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_pathway_access_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_pathway_access_id_seq" OWNED BY "public"."user_pathway_access"."id";



CREATE TABLE IF NOT EXISTS "public"."user_question_flags" (
    "user_id" "uuid" NOT NULL,
    "question_id" bigint NOT NULL,
    "flagged_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE ONLY "public"."user_question_flags" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_question_flags" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_question_flags" IS 'Persistent user-level question flag. Independent of answer correctness/session and remains until the user explicitly unflags the question.';



ALTER TABLE ONLY "public"."bank_access_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."bank_access_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."blocks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."blocks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."free_trial_block_usage" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."free_trial_block_usage_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ip_blocklist" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ip_blocklist_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."login_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."login_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."options" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."options_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pathway_access_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pathway_access_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pathways" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pathways_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."profile_access_audit" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."profile_access_audit_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."question_bank_questions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."question_bank_questions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."question_banks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."question_banks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."questions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."questions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."saved_concepts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."saved_concepts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_access_grants" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_access_grants_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_answers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_answers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_notes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_notes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_pathway_access" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_pathway_access_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."bank_access_audit"
    ADD CONSTRAINT "bank_access_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_test_session_id_key" UNIQUE ("test_session_id");



ALTER TABLE ONLY "public"."ip_blocklist"
    ADD CONSTRAINT "ip_blocklist_ip_address_key" UNIQUE ("ip_address");



ALTER TABLE ONLY "public"."ip_blocklist"
    ADD CONSTRAINT "ip_blocklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."library_articles"
    ADD CONSTRAINT "library_articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."login_history"
    ADD CONSTRAINT "login_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."options"
    ADD CONSTRAINT "options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pathways"
    ADD CONSTRAINT "pathways_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pathways"
    ADD CONSTRAINT "pathways_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profile_access_audit"
    ADD CONSTRAINT "profile_access_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."question_bank_questions"
    ADD CONSTRAINT "question_bank_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."question_bank_questions"
    ADD CONSTRAINT "question_bank_questions_question_bank_id_question_id_key" UNIQUE ("question_bank_id", "question_id");



ALTER TABLE ONLY "public"."question_banks"
    ADD CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_main_id_key" UNIQUE ("main_id");



ALTER TABLE ONLY "public"."questions"
    ADD CONSTRAINT "questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_concepts"
    ADD CONSTRAINT "saved_concepts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_concepts"
    ADD CONSTRAINT "saved_concepts_user_id_question_id_key" UNIQUE ("user_id", "question_id");



ALTER TABLE ONLY "public"."test_session_questions"
    ADD CONSTRAINT "test_session_questions_session_question_key" UNIQUE ("test_session_id", "question_id");



ALTER TABLE ONLY "public"."test_sessions"
    ADD CONSTRAINT "test_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_session_question_key" UNIQUE ("test_session_id", "question_id");



ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_user_id_question_id_key" UNIQUE ("user_id", "question_id");



ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_user_pathway_key" UNIQUE ("user_id", "pathway_id");



ALTER TABLE ONLY "public"."user_question_flags"
    ADD CONSTRAINT "user_question_flags_pkey" PRIMARY KEY ("user_id", "question_id");



CREATE INDEX "idx_bank_access_audit_bank_time" ON "public"."bank_access_audit" USING "btree" ("question_bank_id", "changed_at" DESC);



CREATE INDEX "idx_free_trial_usage_user_bank" ON "public"."free_trial_block_usage" USING "btree" ("user_id", "question_bank_id");



CREATE INDEX "idx_free_trial_usage_user_bank_count" ON "public"."free_trial_block_usage" USING "btree" ("user_id", "question_bank_id", "id");



CREATE INDEX "idx_login_history_ip" ON "public"."login_history" USING "btree" ("ip_address");



CREATE INDEX "idx_login_history_user" ON "public"."login_history" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_mv_topic_counts" ON "public"."question_bank_topic_counts" USING "btree" ("question_bank_id", "category", COALESCE("topic", ''::"text"));



CREATE UNIQUE INDEX "idx_options_one_correct_per_question" ON "public"."options" USING "btree" ("question_id") WHERE ("is_correct" = true);



CREATE INDEX "idx_options_question_id" ON "public"."options" USING "btree" ("question_id");



CREATE INDEX "idx_options_question_order" ON "public"."options" USING "btree" ("question_id", "option_order");



CREATE UNIQUE INDEX "idx_options_unique_order_per_question" ON "public"."options" USING "btree" ("question_id", "option_order");



CREATE INDEX "idx_pathway_access_audit_user_time" ON "public"."pathway_access_audit" USING "btree" ("user_id", "changed_at" DESC);



CREATE INDEX "idx_profile_access_audit_user_time" ON "public"."profile_access_audit" USING "btree" ("user_id", "changed_at" DESC);



CREATE INDEX "idx_profiles_active_role" ON "public"."profiles" USING "btree" ("id", "role") WHERE ("is_active" = true);



CREATE INDEX "idx_qbank_q_bank_id" ON "public"."question_bank_questions" USING "btree" ("question_bank_id", "question_id");



CREATE INDEX "idx_question_bank_questions_bank" ON "public"."question_bank_questions" USING "btree" ("question_bank_id");



CREATE INDEX "idx_question_bank_questions_bank_question" ON "public"."question_bank_questions" USING "btree" ("question_bank_id", "question_id");



CREATE INDEX "idx_question_banks_pathway_trial" ON "public"."question_banks" USING "btree" ("pathway_id", "is_free_trial", "id");



CREATE INDEX "idx_question_banks_trial" ON "public"."question_banks" USING "btree" ("id") WHERE ("is_free_trial" = true);



CREATE INDEX "idx_questions_category" ON "public"."questions" USING "btree" ("category");



CREATE INDEX "idx_questions_category_difficulty_id" ON "public"."questions" USING "btree" ("category", "difficulty", "id");



CREATE INDEX "idx_questions_category_topic_difficulty_id" ON "public"."questions" USING "btree" ("category", "topic", "difficulty", "id");



CREATE INDEX "idx_questions_difficulty" ON "public"."questions" USING "btree" ("difficulty");



CREATE INDEX "idx_questions_main_id" ON "public"."questions" USING "btree" ("main_id");



CREATE INDEX "idx_questions_notes_id" ON "public"."questions" USING "btree" ("notes_id");



CREATE INDEX "idx_questions_topic" ON "public"."questions" USING "btree" ("topic");



CREATE INDEX "idx_saved_concepts_user" ON "public"."saved_concepts" USING "btree" ("user_id");



CREATE INDEX "idx_test_session_questions_session_sort" ON "public"."test_session_questions" USING "btree" ("test_session_id", "sort_order");



CREATE INDEX "idx_test_sessions_user" ON "public"."test_sessions" USING "btree" ("user_id");



CREATE INDEX "idx_test_sessions_user_active" ON "public"."test_sessions" USING "btree" ("user_id", "is_completed", "id");



CREATE INDEX "idx_test_sessions_user_bank_active" ON "public"."test_sessions" USING "btree" ("user_id", "question_bank_id", "is_completed", "started_at" DESC);



CREATE INDEX "idx_test_sessions_user_started_desc" ON "public"."test_sessions" USING "btree" ("user_id", "started_at" DESC);



CREATE UNIQUE INDEX "idx_trial_usage_live_session" ON "public"."free_trial_block_usage" USING "btree" ("test_session_id") WHERE ("test_session_id" IS NOT NULL);



CREATE INDEX "idx_tsq_question_session" ON "public"."test_session_questions" USING "btree" ("question_id", "test_session_id");



CREATE INDEX "idx_user_access_grants_bank" ON "public"."user_access_grants" USING "btree" ("question_bank_id", "user_id") WHERE ("scope_type" = 'bank'::"text");



CREATE INDEX "idx_user_access_grants_pathway" ON "public"."user_access_grants" USING "btree" ("pathway_id", "user_id") WHERE ("scope_type" = 'pathway'::"text");



CREATE INDEX "idx_user_access_grants_user_active" ON "public"."user_access_grants" USING "btree" ("user_id", "scope_type", "starts_at", "expires_at");



CREATE INDEX "idx_user_answers_flagged" ON "public"."user_answers" USING "btree" ("user_id", "question_id") WHERE ("is_flagged" = true);



CREATE INDEX "idx_user_answers_incorrect" ON "public"."user_answers" USING "btree" ("user_id", "question_id") WHERE ("is_correct" = false);



CREATE INDEX "idx_user_answers_latest_state" ON "public"."user_answers" USING "btree" ("user_id", "question_id", "answered_at" DESC, "id" DESC);



CREATE INDEX "idx_user_answers_question" ON "public"."user_answers" USING "btree" ("question_id");



CREATE INDEX "idx_user_answers_session" ON "public"."user_answers" USING "btree" ("test_session_id");



CREATE INDEX "idx_user_answers_session_correct" ON "public"."user_answers" USING "btree" ("test_session_id", "is_correct");



CREATE INDEX "idx_user_answers_session_question_user" ON "public"."user_answers" USING "btree" ("test_session_id", "question_id", "user_id");



CREATE INDEX "idx_user_answers_user" ON "public"."user_answers" USING "btree" ("user_id");



CREATE INDEX "idx_user_answers_user_answered_question" ON "public"."user_answers" USING "btree" ("user_id", "answered_at" DESC, "question_id", "id" DESC);



CREATE INDEX "idx_user_answers_user_id_q_id" ON "public"."user_answers" USING "btree" ("user_id", "question_id");



CREATE INDEX "idx_user_answers_user_is_correct" ON "public"."user_answers" USING "btree" ("user_id", "is_correct");



CREATE INDEX "idx_user_answers_user_is_flagged" ON "public"."user_answers" USING "btree" ("user_id", "is_flagged");



CREATE INDEX "idx_user_answers_user_question" ON "public"."user_answers" USING "btree" ("user_id", "question_id");



CREATE INDEX "idx_user_notes_user" ON "public"."user_notes" USING "btree" ("user_id");



CREATE INDEX "idx_user_pathway_access_active_premium" ON "public"."user_pathway_access" USING "btree" ("user_id", "pathway_id", "expires_at") WHERE ("access_type" = 'premium'::"text");



CREATE INDEX "idx_user_pathway_access_user_pathway_expiry" ON "public"."user_pathway_access" USING "btree" ("user_id", "pathway_id", "access_type", "expires_at");



CREATE INDEX "idx_user_question_flags_question" ON "public"."user_question_flags" USING "btree" ("question_id");



CREATE INDEX "idx_user_question_flags_user_question" ON "public"."user_question_flags" USING "btree" ("user_id", "question_id");



CREATE UNIQUE INDEX "uq_question_bank_questions_question" ON "public"."question_bank_questions" USING "btree" ("question_id");



COMMENT ON INDEX "public"."uq_question_bank_questions_question" IS 'A question belongs to exactly one question bank. Cross-bank question sharing is forbidden.';



CREATE OR REPLACE TRIGGER "a_enforce_answer_finalization_trigger" BEFORE UPDATE ON "public"."user_answers" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_answer_finalization"();



CREATE OR REPLACE TRIGGER "audit_bank_access_change_trigger" AFTER UPDATE OF "is_free_trial", "free_trial_block_limit" ON "public"."question_banks" FOR EACH ROW EXECUTE FUNCTION "public"."audit_bank_access_change"();



CREATE OR REPLACE TRIGGER "audit_pathway_access_change_trigger" AFTER INSERT OR UPDATE ON "public"."user_pathway_access" FOR EACH ROW EXECUTE FUNCTION "public"."audit_pathway_access_change"();



CREATE OR REPLACE TRIGGER "audit_profile_access_change_trigger" AFTER UPDATE OF "role", "subscription_tier", "is_active" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_profile_access_change"();



CREATE OR REPLACE TRIGGER "b_validate_user_answer_relationships_trigger" BEFORE INSERT OR UPDATE OF "test_session_id", "question_id", "selected_option_id", "is_correct" ON "public"."user_answers" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_answer_relationships"();



CREATE OR REPLACE TRIGGER "c_set_answer_server_timestamp" BEFORE INSERT OR UPDATE OF "selected_option_id" ON "public"."user_answers" FOR EACH ROW EXECUTE FUNCTION "public"."set_answer_server_timestamp"();



CREATE OR REPLACE TRIGGER "enforce_free_trial_session_quota_trigger" BEFORE INSERT ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_free_trial_session_quota"();



CREATE OR REPLACE TRIGGER "enforce_test_session_update_integrity_trigger" BEFORE UPDATE ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_test_session_update_integrity"();



CREATE OR REPLACE TRIGGER "record_free_trial_session_usage_trigger" AFTER INSERT ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."record_free_trial_session_usage"();



CREATE OR REPLACE TRIGGER "require_test_session_bank_trigger" BEFORE INSERT OR UPDATE OF "question_bank_id" ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."require_test_session_bank"();



CREATE OR REPLACE TRIGGER "set_ip_block_actor_trigger" BEFORE INSERT OR UPDATE ON "public"."ip_blocklist" FOR EACH ROW EXECUTE FUNCTION "public"."set_ip_block_actor"();



CREATE OR REPLACE TRIGGER "set_login_history_time_trigger" BEFORE INSERT ON "public"."login_history" FOR EACH ROW EXECUTE FUNCTION "public"."set_login_history_time"();



CREATE OR REPLACE TRIGGER "validate_saved_concepts_question_access" BEFORE INSERT OR UPDATE OF "user_id", "question_id" ON "public"."saved_concepts" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_question_write_access"();



CREATE OR REPLACE TRIGGER "validate_user_notes_question_access" BEFORE INSERT OR UPDATE OF "user_id", "question_id" ON "public"."user_notes" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_question_write_access"();



ALTER TABLE ONLY "public"."bank_access_audit"
    ADD CONSTRAINT "bank_access_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."bank_access_audit"
    ADD CONSTRAINT "bank_access_audit_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_session_fk" FOREIGN KEY ("test_session_id") REFERENCES "public"."test_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ip_blocklist"
    ADD CONSTRAINT "ip_blocklist_blocked_by_fkey" FOREIGN KEY ("blocked_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."login_history"
    ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."options"
    ADD CONSTRAINT "options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_access_audit"
    ADD CONSTRAINT "profile_access_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profile_access_audit"
    ADD CONSTRAINT "profile_access_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_bank_questions"
    ADD CONSTRAINT "question_bank_questions_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_bank_questions"
    ADD CONSTRAINT "question_bank_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."question_banks"
    ADD CONSTRAINT "question_banks_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_concepts"
    ADD CONSTRAINT "saved_concepts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_concepts"
    ADD CONSTRAINT "saved_concepts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_session_questions"
    ADD CONSTRAINT "test_session_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_session_questions"
    ADD CONSTRAINT "test_session_questions_test_session_id_fkey" FOREIGN KEY ("test_session_id") REFERENCES "public"."test_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_sessions"
    ADD CONSTRAINT "test_sessions_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."test_sessions"
    ADD CONSTRAINT "test_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "public"."options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_test_session_id_fkey" FOREIGN KEY ("test_session_id") REFERENCES "public"."test_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_question_flags"
    ADD CONSTRAINT "user_question_flags_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_question_flags"
    ADD CONSTRAINT "user_question_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Active users can read accessible bank mappings" ON "public"."question_bank_questions" FOR SELECT TO "authenticated" USING ("public"."can_access_question_bank"("question_bank_id"));



CREATE POLICY "Active users can read accessible questions" ON "public"."questions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."question_bank_questions" "qbq"
  WHERE (("qbq"."question_id" = "questions"."id") AND "public"."can_access_question_bank"("qbq"."question_bank_id")))));



CREATE POLICY "Active users can read blocks" ON "public"."blocks" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());



CREATE POLICY "Active users can read library articles" ON "public"."library_articles" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());



CREATE POLICY "Active users can read options for accessible questions" ON "public"."options" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."question_bank_questions" "qbq"
  WHERE (("qbq"."question_id" = "options"."question_id") AND "public"."can_access_question_bank"("qbq"."question_bank_id")))));



CREATE POLICY "Active users can read pathways" ON "public"."pathways" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());



CREATE POLICY "Active users can read question bank metadata" ON "public"."question_banks" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());



CREATE POLICY "Active users delete own accessible concepts" ON "public"."saved_concepts" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users delete own accessible flags" ON "public"."user_question_flags" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users delete own accessible notes" ON "public"."user_notes" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users delete own incomplete test_sessions" ON "public"."test_sessions" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND ("is_completed" = false)));



CREATE POLICY "Active users insert own accessible answers" ON "public"."user_answers" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users insert own accessible concepts" ON "public"."saved_concepts" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users insert own accessible flags" ON "public"."user_question_flags" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users insert own accessible notes" ON "public"."user_notes" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users insert own login history" ON "public"."login_history" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"()));



CREATE POLICY "Active users read own accessible answers" ON "public"."user_answers" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users read own accessible concepts" ON "public"."saved_concepts" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users read own accessible flags" ON "public"."user_question_flags" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users read own accessible notes" ON "public"."user_notes" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users read own accessible test_sessions" ON "public"."test_sessions" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question_bank"("question_bank_id")));



CREATE POLICY "Active users update own accessible answers" ON "public"."user_answers" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users update own accessible concepts" ON "public"."saved_concepts" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users update own accessible notes" ON "public"."user_notes" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));



CREATE POLICY "Active users update own accessible test_sessions" ON "public"."test_sessions" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question_bank"("question_bank_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question_bank"("question_bank_id")));



CREATE POLICY "Active users view own pathway access or staff view all" ON "public"."user_pathway_access" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_id") AND "public"."is_active_user"()) OR "public"."is_support_or_admin"()));



CREATE POLICY "Admins can read bank access audit" ON "public"."bank_access_audit" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins can read profile access audit" ON "public"."profile_access_audit" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins delete ip blocklist" ON "public"."ip_blocklist" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins insert ip blocklist" ON "public"."ip_blocklist" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins read ip blocklist" ON "public"."ip_blocklist" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins update ip blocklist" ON "public"."ip_blocklist" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Staff can read pathway access audit" ON "public"."pathway_access_audit" FOR SELECT TO "authenticated" USING ("public"."is_support_or_admin"());



CREATE POLICY "Users can view own scoped access" ON "public"."user_access_grants" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_support_or_admin"()));



CREATE POLICY "Users read accessible locked session questions" ON "public"."test_session_questions" FOR SELECT TO "authenticated" USING (("public"."is_active_user"() AND "public"."can_read_locked_session"("test_session_id")));



CREATE POLICY "Users view own login history or admins view all" ON "public"."login_history" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_id") AND "public"."is_active_user"()) OR "public"."is_admin"()));



CREATE POLICY "Users view own profile or active staff view all" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "id") OR "public"."is_support_or_admin"()));



CREATE POLICY "Users view own trial usage or staff audit all" ON "public"."free_trial_block_usage" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_id") AND "public"."is_active_user"()) OR "public"."is_support_or_admin"()));



ALTER TABLE "public"."bank_access_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."free_trial_block_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ip_blocklist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."library_articles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."login_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pathway_access_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pathways" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_access_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_bank_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."question_banks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_concepts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_session_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."test_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_access_grants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_answers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_pathway_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_question_flags" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON TABLE "public"."question_banks" TO "anon";
GRANT ALL ON TABLE "public"."question_banks" TO "authenticated";
GRANT ALL ON TABLE "public"."question_banks" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_bank_access_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_bank_access_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_bank_access_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_bank_access_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_pathway_access_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_pathway_access_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_pathway_access_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_pathway_access_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_profile_access_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_profile_access_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_profile_access_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_profile_access_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."test_sessions" TO "anon";
GRANT ALL ON TABLE "public"."test_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."test_sessions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_answer_finalization"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_answer_finalization"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_answer_finalization"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_answer_finalization"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_access_grants" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_access_grants" TO "authenticated";
GRANT ALL ON TABLE "public"."user_access_grants" TO "service_role";



REVOKE ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) TO "service_role";



GRANT ALL ON TABLE "public"."user_pathway_access" TO "anon";
GRANT ALL ON TABLE "public"."user_pathway_access" TO "authenticated";
GRANT ALL ON TABLE "public"."user_pathway_access" TO "service_role";



REVOKE ALL ON FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_active_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_ip_blocked"("client_ip" "inet") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_ip_blocked"("client_ip" "inet") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ip_blocked"("client_ip" "inet") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_support_or_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_support_or_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_support_or_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_support_or_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_free_trial_session_usage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_free_trial_session_usage"() TO "anon";
GRANT ALL ON FUNCTION "public"."record_free_trial_session_usage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_free_trial_session_usage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_question_bank_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_question_bank_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_question_bank_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."require_test_session_bank"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."require_test_session_bank"() TO "anon";
GRANT ALL ON FUNCTION "public"."require_test_session_bank"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."require_test_session_bank"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_answer_server_timestamp"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_answer_server_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_answer_server_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_answer_server_timestamp"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_ip_block_actor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_ip_block_actor"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_ip_block_actor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ip_block_actor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_login_history_time"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_login_history_time"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_login_history_time"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_login_history_time"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_user_answer_relationships"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_user_answer_relationships"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_user_answer_relationships"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_user_answer_relationships"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_user_question_write_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_user_question_write_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_user_question_write_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_user_question_write_access"() TO "service_role";


















GRANT ALL ON TABLE "public"."bank_access_audit" TO "anon";
GRANT ALL ON TABLE "public"."bank_access_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_access_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."bank_access_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."bank_access_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."bank_access_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."blocks" TO "anon";
GRANT ALL ON TABLE "public"."blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."blocks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."blocks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."blocks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."blocks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."free_trial_block_usage" TO "anon";
GRANT ALL ON TABLE "public"."free_trial_block_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."free_trial_block_usage" TO "service_role";



GRANT ALL ON SEQUENCE "public"."free_trial_block_usage_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."free_trial_block_usage_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."free_trial_block_usage_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ip_blocklist" TO "anon";
GRANT ALL ON TABLE "public"."ip_blocklist" TO "authenticated";
GRANT ALL ON TABLE "public"."ip_blocklist" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ip_blocklist_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ip_blocklist_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ip_blocklist_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."library_articles" TO "anon";
GRANT ALL ON TABLE "public"."library_articles" TO "authenticated";
GRANT ALL ON TABLE "public"."library_articles" TO "service_role";



GRANT ALL ON TABLE "public"."login_history" TO "anon";
GRANT ALL ON TABLE "public"."login_history" TO "authenticated";
GRANT ALL ON TABLE "public"."login_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."login_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."login_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."login_history_id_seq" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."options" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."options" TO "authenticated";
GRANT ALL ON TABLE "public"."options" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."options" TO "authenticated";



GRANT SELECT("question_id") ON TABLE "public"."options" TO "authenticated";



GRANT SELECT("text_html") ON TABLE "public"."options" TO "authenticated";



GRANT SELECT("option_order") ON TABLE "public"."options" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."options_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."options_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."options_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pathway_access_audit" TO "anon";
GRANT ALL ON TABLE "public"."pathway_access_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."pathway_access_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pathway_access_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pathway_access_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pathway_access_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pathways" TO "anon";
GRANT ALL ON TABLE "public"."pathways" TO "authenticated";
GRANT ALL ON TABLE "public"."pathways" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pathways_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pathways_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pathways_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profile_access_audit" TO "anon";
GRANT ALL ON TABLE "public"."profile_access_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_access_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."profile_access_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."profile_access_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."profile_access_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."question_bank_questions" TO "anon";
GRANT ALL ON TABLE "public"."question_bank_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."question_bank_questions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."question_bank_questions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."question_bank_questions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."question_bank_questions_id_seq" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."questions" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."questions" TO "authenticated";
GRANT ALL ON TABLE "public"."questions" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("main_id") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("text_html") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("category") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("topic") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("concept_id") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("notes_id") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("difficulty") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("source") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("pm_question_id") ON TABLE "public"."questions" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."questions" TO "authenticated";



GRANT ALL ON TABLE "public"."question_bank_topic_counts" TO "anon";
GRANT ALL ON TABLE "public"."question_bank_topic_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."question_bank_topic_counts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."question_banks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."question_banks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."question_banks_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."questions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."questions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."questions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."saved_concepts" TO "anon";
GRANT ALL ON TABLE "public"."saved_concepts" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_concepts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."saved_concepts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."saved_concepts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."saved_concepts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."test_session_questions" TO "anon";
GRANT ALL ON TABLE "public"."test_session_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."test_session_questions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_access_grants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_access_grants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_access_grants_id_seq" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."user_answers" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."user_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."user_answers" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("test_session_id") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("user_id") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("question_id") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("selected_option_id") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("is_flagged") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("time_spent_seconds") ON TABLE "public"."user_answers" TO "authenticated";



GRANT SELECT("answered_at") ON TABLE "public"."user_answers" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."user_answers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_answers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_answers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_latest_answer_state" TO "service_role";



GRANT ALL ON TABLE "public"."user_notes" TO "anon";
GRANT ALL ON TABLE "public"."user_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_notes_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_pathway_access_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_pathway_access_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_pathway_access_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_question_flags" TO "anon";
GRANT ALL ON TABLE "public"."user_question_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."user_question_flags" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();




-- =============================================================================
-- POST-SQUASH CLIENT PRIVILEGE LOCKDOWN
-- Supabase schema dumps do not preserve explicit REVOKEs that narrow the
-- platform's default table privileges, so re-apply them after dump grants.
-- =============================================================================

REVOKE SELECT ON TABLE public.questions FROM anon, authenticated;
GRANT SELECT (
    id,
    main_id,
    text_html,
    category,
    topic,
    concept_id,
    notes_id,
    difficulty,
    source,
    pm_question_id,
    created_at
) ON TABLE public.questions TO authenticated;

REVOKE SELECT ON TABLE public.options FROM anon, authenticated;
GRANT SELECT (
    id,
    question_id,
    text_html,
    option_order
) ON TABLE public.options TO authenticated;

REVOKE SELECT ON TABLE public.user_answers FROM anon, authenticated;
GRANT SELECT (
    id,
    test_session_id,
    user_id,
    question_id,
    selected_option_id,
    is_flagged,
    time_spent_seconds,
    answered_at
) ON TABLE public.user_answers TO authenticated;

REVOKE ALL ON TABLE public.user_latest_answer_state FROM PUBLIC;
REVOKE ALL ON TABLE public.user_latest_answer_state FROM anon;
REVOKE ALL ON TABLE public.user_latest_answer_state FROM authenticated;
