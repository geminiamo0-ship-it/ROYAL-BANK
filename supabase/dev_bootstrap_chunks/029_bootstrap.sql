SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE OR REPLACE FUNCTION public.admin_get_user_detail(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_grants JSONB := '[]'::jsonb;
    v_audit JSONB := '[]'::jsonb;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'USER_NOT_FOUND';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', grant_row.id,
                'scope_type', grant_row.scope_type,
                'pathway_id', grant_row.pathway_id,
                'question_bank_id', grant_row.question_bank_id,
                'scope_name', CASE
                    WHEN grant_row.scope_type = 'global' THEN 'All Royal access'
                    WHEN grant_row.scope_type = 'pathway' THEN COALESCE(pathway.name, 'Pathway #' || grant_row.pathway_id::TEXT)
                    ELSE COALESCE(bank.name, 'Question bank #' || grant_row.question_bank_id::TEXT)
                END,
                'starts_at', grant_row.starts_at,
                'expires_at', grant_row.expires_at,
                'created_at', grant_row.created_at,
                'granted_by', grant_row.granted_by,
                'granted_by_name', grant_actor.full_name,
                'revoked_at', grant_row.revoked_at,
                'revoked_by', grant_row.revoked_by,
                'revoked_by_name', revoke_actor.full_name,
                'revoke_reason', grant_row.revoke_reason,
                'status', CASE
                    WHEN grant_row.revoked_at IS NOT NULL THEN 'revoked'
                    WHEN grant_row.starts_at > now() THEN 'upcoming'
                    WHEN grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now() THEN 'expired'
                    ELSE 'active'
                END
            )
            ORDER BY grant_row.created_at DESC, grant_row.id DESC
        ),
        '[]'::jsonb
    ) INTO v_grants
    FROM public.user_access_grants grant_row
    LEFT JOIN public.pathways pathway ON pathway.id = grant_row.pathway_id
    LEFT JOIN public.question_banks bank ON bank.id = grant_row.question_bank_id
    LEFT JOIN public.profiles grant_actor ON grant_actor.id = grant_row.granted_by
    LEFT JOIN public.profiles revoke_actor ON revoke_actor.id = grant_row.revoked_by
    WHERE grant_row.user_id = p_user_id;

    SELECT COALESCE(jsonb_agg(to_jsonb(audit_row) ORDER BY audit_row.created_at DESC), '[]'::jsonb)
    INTO v_audit
    FROM (
        SELECT
            log.id,
            log.actor_user_id,
            log.actor_role,
            log.action,
            log.entity_type,
            log.entity_id,
            log.metadata,
            log.created_at
        FROM public.admin_audit_logs log
        WHERE (log.entity_type = 'user' AND log.entity_id = p_user_id::TEXT)
           OR (
               log.entity_type = 'user_access_grant'
               AND log.entity_id IN (
                   SELECT grant_row.id::TEXT
                   FROM public.user_access_grants grant_row
                   WHERE grant_row.user_id = p_user_id
               )
           )
        ORDER BY log.created_at DESC, log.id DESC
        LIMIT 50
    ) audit_row;

    RETURN jsonb_build_object(
        'profile', jsonb_build_object(
            'id', v_profile.id,
            'full_name', v_profile.full_name,
            'email', v_profile.email,
            'role', v_profile.role,
            'subscription_tier', v_profile.subscription_tier,
            'is_active', v_profile.is_active,
            'last_login_at', v_profile.last_login_at,
            'last_login_ip', v_profile.last_login_ip,
            'created_at', v_profile.created_at,
            'updated_at', v_profile.updated_at
        ),
        'grants', v_grants,
        'audit', v_audit
    );
END;
$$;

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
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
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

CREATE OR REPLACE FUNCTION public.admin_grant_user_access(
    p_user_id UUID,
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL,
    p_starts_at TIMESTAMPTZ DEFAULT now(),
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF private.business_user_has_covering_grant(
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id
    ) THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_ACTIVE';
    END IF;

    SELECT * INTO v_grant
    FROM public.grant_user_access(
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id,
        p_starts_at,
        p_expires_at
    );

    PERFORM private.business_audit(
        'manual_access_granted',
        'user_access_grant',
        v_grant.id::TEXT,
        jsonb_build_object(
            'user_id', v_grant.user_id,
            'scope_type', v_grant.scope_type,
            'pathway_id', v_grant.pathway_id,
            'question_bank_id', v_grant.question_bank_id,
            'starts_at', v_grant.starts_at,
            'expires_at', v_grant.expires_at
        )
    );

    RETURN jsonb_build_object(
        'id', v_grant.id,
        'user_id', v_grant.user_id,
        'scope_type', v_grant.scope_type,
        'pathway_id', v_grant.pathway_id,
        'question_bank_id', v_grant.question_bank_id,
        'starts_at', v_grant.starts_at,
        'expires_at', v_grant.expires_at,
        'status', 'active'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_extend_user_access(
    p_grant_id BIGINT,
    p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
    v_old_expires TIMESTAMPTZ;
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    SELECT * INTO v_grant
    FROM public.user_access_grants
    WHERE id = p_grant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ACCESS_GRANT_NOT_FOUND';
    END IF;

    IF v_grant.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'REVOKED_ACCESS_CANNOT_BE_EXTENDED';
    END IF;

    IF v_grant.expires_at IS NULL THEN
        RAISE EXCEPTION 'ACCESS_ALREADY_PERMANENT';
    END IF;

    IF p_expires_at IS NULL
       OR p_expires_at <= now()
       OR p_expires_at <= v_grant.starts_at
       OR p_expires_at <= v_grant.expires_at THEN
        RAISE EXCEPTION 'INVALID_ACCESS_EXTENSION';
    END IF;

    v_old_expires := v_grant.expires_at;

    UPDATE public.user_access_grants
    SET expires_at = p_expires_at
    WHERE id = p_grant_id
    RETURNING * INTO v_grant;

    PERFORM private.business_audit(
        'access_grant_extended',
        'user_access_grant',
        p_grant_id::TEXT,
        jsonb_build_object(
            'user_id', v_grant.user_id,
            'old_expires_at', v_old_expires,
            'new_expires_at', v_grant.expires_at
        )
    );

    RETURN jsonb_build_object(
        'id', v_grant.id,
        'expires_at', v_grant.expires_at,
        'status', CASE WHEN v_grant.expires_at > now() THEN 'active' ELSE 'expired' END
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_user_access(
    p_grant_id BIGINT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_grant public.user_access_grants%ROWTYPE;
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_now TIMESTAMPTZ := timezone('utc'::text, clock_timestamp());
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'REVOKE_REASON_REQUIRED';
    END IF;

    SELECT * INTO v_grant
    FROM public.user_access_grants
    WHERE id = p_grant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ACCESS_GRANT_NOT_FOUND';
    END IF;

    IF v_grant.revoked_at IS NULL THEN
        UPDATE public.user_access_grants
        SET
            revoked_at = v_now,
            revoked_by = auth.uid(),
            revoke_reason = v_reason
        WHERE id = p_grant_id
        RETURNING * INTO v_grant;

        PERFORM private.business_audit(
            'access_grant_revoked',
            'user_access_grant',
            p_grant_id::TEXT,
            jsonb_build_object(
                'user_id', v_grant.user_id,
                'scope_type', v_grant.scope_type,
                'pathway_id', v_grant.pathway_id,
                'question_bank_id', v_grant.question_bank_id,
                'reason', v_reason
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'id', v_grant.id,
        'revoked_at', v_grant.revoked_at,
        'revoke_reason', v_grant.revoke_reason,
        'status', 'revoked'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_operations_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    RETURN jsonb_build_object(
        'total_users', (SELECT COUNT(*) FROM public.profiles),
        'active_users', (SELECT COUNT(*) FROM public.profiles WHERE is_active = TRUE),
        'inactive_users', (SELECT COUNT(*) FROM public.profiles WHERE is_active = FALSE),
        'student_users', (SELECT COUNT(*) FROM public.profiles WHERE role = 'student'),
        'support_users', (SELECT COUNT(*) FROM public.profiles WHERE role = 'support'),
        'admin_users', (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin'),
        'active_grants', (
            SELECT COUNT(*) FROM public.user_access_grants
            WHERE revoked_at IS NULL
              AND starts_at <= now()
              AND (expires_at IS NULL OR expires_at > now())
        ),
        'open_requests', (
            SELECT COUNT(*) FROM public.upgrade_requests
            WHERE status IN ('pending', 'contacted', 'paid')
        ),
        'pending_requests', (SELECT COUNT(*) FROM public.upgrade_requests WHERE status = 'pending'),
        'contacted_requests', (SELECT COUNT(*) FROM public.upgrade_requests WHERE status = 'contacted'),
        'paid_awaiting_activation', (SELECT COUNT(*) FROM public.upgrade_requests WHERE status = 'paid'),
        'activations_30d', (
            SELECT COUNT(*) FROM public.upgrade_requests
            WHERE status = 'activated'
              AND activated_at >= now() - interval '30 days'
        ),
        'new_users_30d', (
            SELECT COUNT(*) FROM public.profiles
            WHERE created_at >= now() - interval '30 days'
        )
    );
END;
$$;
