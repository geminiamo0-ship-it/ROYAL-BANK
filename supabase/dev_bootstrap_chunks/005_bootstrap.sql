SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

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
