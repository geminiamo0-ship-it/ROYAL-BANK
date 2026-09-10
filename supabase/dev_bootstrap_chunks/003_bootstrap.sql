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
