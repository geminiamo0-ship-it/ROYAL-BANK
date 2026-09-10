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
