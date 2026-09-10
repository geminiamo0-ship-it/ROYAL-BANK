-- ROYAL-BANK consolidated core baseline.




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

CREATE SCHEMA IF NOT EXISTS "public";

ALTER SCHEMA "public" OWNER TO "pg_database_owner";

COMMENT ON SCHEMA "public" IS 'ROYAL-BANK core security baseline: role-gated privileged operations, bank-gated question content, persistent question flags, canonical question-state RPC, server-derived answer correctness, and database-enforced free-trial quota.';

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
