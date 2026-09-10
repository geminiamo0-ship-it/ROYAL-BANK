SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE OR REPLACE FUNCTION public.admin_get_support_performance(
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_agents JSONB := '[]'::jsonb;
    v_summary JSONB;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    WITH actor_ids AS (
        SELECT contacted_by AS actor_id
        FROM public.upgrade_requests
        WHERE contacted_by IS NOT NULL AND contacted_at >= p_from AND contacted_at < p_to
        UNION
        SELECT activated_by
        FROM public.upgrade_requests
        WHERE activated_by IS NOT NULL AND activated_at >= p_from AND activated_at < p_to
        UNION
        SELECT recorded_by
        FROM public.payments
        WHERE recorded_by IS NOT NULL AND paid_at >= p_from AND paid_at < p_to
    ),
    agent_rows AS (
        SELECT
            profile.id,
            profile.full_name,
            profile.email,
            profile.role,
            (
                SELECT COUNT(*) FROM public.upgrade_requests request_row
                WHERE request_row.contacted_by = profile.id
                  AND request_row.contacted_at >= p_from
                  AND request_row.contacted_at < p_to
            )::BIGINT AS contacts,
            (
                SELECT COUNT(*) FROM public.upgrade_requests request_row
                WHERE request_row.activated_by = profile.id
                  AND request_row.activated_at >= p_from
                  AND request_row.activated_at < p_to
            )::BIGINT AS activations,
            (
                SELECT COUNT(*) FROM public.payments payment
                WHERE payment.recorded_by = profile.id
                  AND payment.paid_at >= p_from
                  AND payment.paid_at < p_to
                  AND payment.status IN ('confirmed', 'refunded')
            )::BIGINT AS payments_recorded,
            (
                SELECT round(avg(extract(epoch FROM (request_row.contacted_at - request_row.created_at)) / 60.0)::NUMERIC, 1)
                FROM public.upgrade_requests request_row
                WHERE request_row.contacted_by = profile.id
                  AND request_row.contacted_at >= p_from
                  AND request_row.contacted_at < p_to
                  AND request_row.contacted_at >= request_row.created_at
            ) AS avg_first_contact_minutes,
            (
                SELECT round(avg(extract(epoch FROM (request_row.activated_at - request_row.created_at)) / 60.0)::NUMERIC, 1)
                FROM public.upgrade_requests request_row
                WHERE request_row.activated_by = profile.id
                  AND request_row.activated_at >= p_from
                  AND request_row.activated_at < p_to
                  AND request_row.activated_at >= request_row.created_at
            ) AS avg_activation_minutes
        FROM actor_ids actor
        JOIN public.profiles profile ON profile.id = actor.actor_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'user_id', row_data.id,
                'full_name', row_data.full_name,
                'email', row_data.email,
                'role', row_data.role,
                'contacts', row_data.contacts,
                'activations', row_data.activations,
                'payments_recorded', row_data.payments_recorded,
                'avg_first_contact_minutes', row_data.avg_first_contact_minutes,
                'avg_activation_minutes', row_data.avg_activation_minutes
            )
            ORDER BY row_data.activations DESC, row_data.contacts DESC, row_data.email
        ),
        '[]'::jsonb
    ) INTO v_agents
    FROM agent_rows row_data;

    SELECT jsonb_build_object(
        'contacts', (
            SELECT COUNT(*) FROM public.upgrade_requests
            WHERE contacted_at >= p_from AND contacted_at < p_to
        ),
        'activations', (
            SELECT COUNT(*) FROM public.upgrade_requests
            WHERE activated_at >= p_from AND activated_at < p_to
        ),
        'payments_recorded', (
            SELECT COUNT(*) FROM public.payments
            WHERE paid_at >= p_from AND paid_at < p_to
              AND status IN ('confirmed', 'refunded')
        ),
        'avg_first_contact_minutes', (
            SELECT round(avg(extract(epoch FROM (contacted_at - created_at)) / 60.0)::NUMERIC, 1)
            FROM public.upgrade_requests
            WHERE contacted_at >= p_from AND contacted_at < p_to
              AND contacted_at >= created_at
        ),
        'avg_activation_minutes', (
            SELECT round(avg(extract(epoch FROM (activated_at - created_at)) / 60.0)::NUMERIC, 1)
            FROM public.upgrade_requests
            WHERE activated_at >= p_from AND activated_at < p_to
              AND activated_at >= created_at
        ),
        'open_backlog', (
            SELECT COUNT(*) FROM public.upgrade_requests
            WHERE status IN ('pending', 'contacted', 'paid')
        ),
        'paid_awaiting_activation', (
            SELECT COUNT(*) FROM public.upgrade_requests
            WHERE status = 'paid'
        )
    ) INTO v_summary;

    RETURN jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'summary', v_summary,
        'agents', v_agents
    );
END;
$$;

-- These functions intentionally remain callable only by authenticated sessions;
-- every privileged function also checks the actor's live profile role server-side.
REVOKE ALL ON FUNCTION public.admin_list_users(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_get_user_detail(UUID) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_grant_user_access(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_extend_user_access(BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_revoke_user_access(BIGINT, TEXT) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_get_operations_summary() FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_get_support_performance(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.grant_user_access(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.revoke_user_access(BIGINT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_users(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_user_detail(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_grant_user_access(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_extend_user_access(BIGINT, TIMESTAMPTZ) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_revoke_user_access(BIGINT, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_operations_summary() TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_support_performance(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

GRANT EXECUTE ON FUNCTION public.grant_user_access(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_user_access(BIGINT) TO authenticated;

-- Release C centralized access-management read surface.

CREATE OR REPLACE FUNCTION public.admin_list_access_grants(
    p_search TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 200,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id BIGINT,
    user_id UUID,
    full_name TEXT,
    email TEXT,
    scope_type TEXT,
    scope_name TEXT,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    status TEXT,
    granted_by UUID,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revoke_reason TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_search TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_status TEXT := NULLIF(lower(btrim(COALESCE(p_status, ''))), '');
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_search IS NOT NULL AND char_length(v_search) > 200 THEN
        RAISE EXCEPTION 'INVALID_ACCESS_SEARCH';
    END IF;

    IF v_status IS NOT NULL AND v_status NOT IN ('active', 'upcoming', 'expired', 'revoked') THEN
        RAISE EXCEPTION 'INVALID_ACCESS_STATUS';
    END IF;

    RETURN QUERY
    WITH grant_rows AS (
        SELECT
            grant_row.id,
            grant_row.user_id,
            profile.full_name,
            profile.email,
            grant_row.scope_type,
            CASE
                WHEN grant_row.scope_type = 'global' THEN 'All Royal access'
                WHEN grant_row.scope_type = 'pathway' THEN COALESCE(pathway.name, 'Pathway #' || grant_row.pathway_id::TEXT)
                ELSE COALESCE(bank.name, 'Question bank #' || grant_row.question_bank_id::TEXT)
            END AS scope_name,
            grant_row.starts_at,
            grant_row.expires_at,
            CASE
                WHEN grant_row.revoked_at IS NOT NULL THEN 'revoked'
                WHEN grant_row.starts_at > now() THEN 'upcoming'
                WHEN grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now() THEN 'expired'
                ELSE 'active'
            END AS status,
            grant_row.granted_by,
            grant_row.revoked_at,
            grant_row.revoked_by,
            grant_row.revoke_reason,
            grant_row.created_at
        FROM public.user_access_grants grant_row
        JOIN public.profiles profile ON profile.id = grant_row.user_id
        LEFT JOIN public.pathways pathway ON pathway.id = grant_row.pathway_id
        LEFT JOIN public.question_banks bank ON bank.id = grant_row.question_bank_id
        WHERE v_search IS NULL
           OR profile.email ILIKE '%' || v_search || '%'
           OR COALESCE(profile.full_name, '') ILIKE '%' || v_search || '%'
           OR profile.id::TEXT = v_search
           OR grant_row.id::TEXT = v_search
    )
    SELECT
        grant_rows.id,
        grant_rows.user_id,
        grant_rows.full_name,
        grant_rows.email,
        grant_rows.scope_type,
        grant_rows.scope_name,
        grant_rows.starts_at,
        grant_rows.expires_at,
        grant_rows.status,
        grant_rows.granted_by,
        grant_rows.revoked_at,
        grant_rows.revoked_by,
        grant_rows.revoke_reason,
        grant_rows.created_at
    FROM grant_rows
    WHERE v_status IS NULL OR grant_rows.status = v_status
    ORDER BY grant_rows.created_at DESC, grant_rows.id DESC
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_access_grants(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_access_grants(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

-- Preserve the legacy error text contract used by the existing security regression
-- suite while keeping the Release C audit and lockout protections.

CREATE OR REPLACE FUNCTION public.admin_update_user_access(
    p_user_id UUID,
    p_role TEXT DEFAULT NULL,
    p_subscription_tier TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_before public.profiles%ROWTYPE;
    v_after public.profiles%ROWTYPE;
    v_role TEXT := CASE WHEN p_role IS NULL THEN NULL ELSE lower(btrim(p_role)) END;
    v_tier TEXT := CASE WHEN p_subscription_tier IS NULL THEN NULL ELSE lower(btrim(p_subscription_tier)) END;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    SELECT * INTO v_before
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND';
    END IF;

    IF v_role IS NOT NULL AND v_role NOT IN ('student', 'admin', 'support') THEN
        RAISE EXCEPTION 'INVALID_USER_ROLE';
    END IF;

    IF v_tier IS NOT NULL AND v_tier NOT IN ('free_trial', 'premium_individual', 'premium_full') THEN
        RAISE EXCEPTION 'INVALID_SUBSCRIPTION_TIER';
    END IF;

    IF p_user_id = auth.uid()
       AND ((v_role IS NOT NULL AND v_role <> 'admin') OR p_is_active = FALSE) THEN
        RAISE EXCEPTION 'ADMIN_SELF_LOCKOUT';
    END IF;

    IF v_before.role = 'admin'
       AND v_before.is_active
       AND ((v_role IS NOT NULL AND v_role <> 'admin') OR p_is_active = FALSE)
       AND (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin' AND is_active = TRUE) <= 1 THEN
        RAISE EXCEPTION 'LAST_ADMIN_PROTECTED';
    END IF;

    UPDATE public.profiles
    SET
        role = COALESCE(v_role, role),
        subscription_tier = COALESCE(v_tier, subscription_tier),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_user_id
    RETURNING * INTO v_after;

    IF v_before.role IS DISTINCT FROM v_after.role
       OR v_before.subscription_tier IS DISTINCT FROM v_after.subscription_tier
       OR v_before.is_active IS DISTINCT FROM v_after.is_active THEN
        PERFORM private.business_audit(
            'user_access_profile_updated',
            'user',
            p_user_id::TEXT,
            jsonb_build_object(
                'before', jsonb_build_object(
                    'role', v_before.role,
                    'subscription_tier', v_before.subscription_tier,
                    'is_active', v_before.is_active
                ),
                'after', jsonb_build_object(
                    'role', v_after.role,
                    'subscription_tier', v_after.subscription_tier,
                    'is_active', v_after.is_active
                )
            )
        );
    END IF;

    RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_update_user_access(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- Release C follow-up hardening after production database-advisor review.
-- Privileged business/admin/support/partner RPCs must never be executable by anon.
-- Signed-in callers keep EXECUTE because each privileged RPC performs its own live
-- role/ownership check server-side.

DO $$
DECLARE
    function_row RECORD;
BEGIN
    FOR function_row IN
        SELECT p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (
              p.proname LIKE 'admin\_%' ESCAPE '\'
              OR p.proname LIKE 'support\_%' ESCAPE '\'
              OR p.proname LIKE 'partner\_%' ESCAPE '\'
              OR p.proname IN (
                  'create_upgrade_request',
                  'get_my_active_access_grants',
                  'grant_user_access',
                  'revoke_user_access'
              )
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', function_row.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', function_row.signature);
    END LOOP;
END;
$$;

-- Production currently has an additional bigint overload that is not part of a fresh
-- migration rebuild. Harden every existing overload instead of assuming environments
-- have exactly the same historical function signatures.
DO $$
DECLARE
    function_row RECORD;
BEGIN
    FOR function_row IN
        SELECT p.oid::regprocedure::text AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('get_category_topic_counts', 'get_category_topic_counts_json')
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %s SET search_path TO %L, %L',
            function_row.signature,
            'public',
            'pg_temp'
        );
    END LOOP;
END;
$$;

-- The application uses the supported topic-count RPC surface, not direct materialized
-- view reads. If the view exists in this environment, keep raw rows out of Data API.
DO $$
BEGIN
    IF to_regclass('public.question_bank_topic_counts') IS NOT NULL THEN
        REVOKE ALL ON TABLE public.question_bank_topic_counts FROM anon, authenticated;
    END IF;
END;
$$;

-- 036 introduced an index identical to the pre-existing support queue index.
-- Keep the established index and remove the duplicate write/storage overhead.
DROP INDEX IF EXISTS public.idx_upgrade_requests_status_created_at;

-- Release D: product analytics and security/risk foundations.
-- Trial analytics are defined in 041; alerts/reports are defined in 042.

CREATE INDEX IF NOT EXISTS idx_free_trial_usage_consumed_user_bank
    ON public.free_trial_block_usage (consumed_at DESC, user_id, question_bank_id);

CREATE INDEX IF NOT EXISTS idx_test_sessions_started_user_bank
    ON public.test_sessions (started_at DESC, user_id, question_bank_id);

CREATE INDEX IF NOT EXISTS idx_user_answers_answered_user
    ON public.user_answers (answered_at DESC, user_id);

CREATE INDEX IF NOT EXISTS idx_login_history_suspicious_time
    ON public.login_history (login_at DESC, user_id)
    WHERE is_suspicious IS TRUE;
