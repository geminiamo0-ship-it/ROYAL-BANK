-- Release C: production operations surfaces for user administration, access control,
-- operational overview, support performance, and explicit admin RBAC.

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status_created_at
    ON public.upgrade_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_contacted_by_at
    ON public.upgrade_requests (contacted_by, contacted_at DESC)
    WHERE contacted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_activated_by_at
    ON public.upgrade_requests (activated_by, activated_at DESC)
    WHERE activated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_recorded_by_paid_at
    ON public.payments (recorded_by, paid_at DESC)
    WHERE recorded_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_list_users(
    p_search TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id UUID,
    full_name TEXT,
    email TEXT,
    role TEXT,
    subscription_tier TEXT,
    is_active BOOLEAN,
    last_login_at TIMESTAMPTZ,
    last_login_ip INET,
    created_at TIMESTAMPTZ,
    active_grant_count BIGINT,
    latest_access_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_search TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
    v_role TEXT := NULLIF(lower(btrim(COALESCE(p_role, ''))), '');
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250);
    v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF v_search IS NOT NULL AND char_length(v_search) > 200 THEN
        RAISE EXCEPTION 'INVALID_USER_SEARCH';
    END IF;

    IF v_role IS NOT NULL AND v_role NOT IN ('student', 'support', 'admin') THEN
        RAISE EXCEPTION 'INVALID_USER_ROLE';
    END IF;

    RETURN QUERY
    SELECT
        profile.id,
        profile.full_name,
        profile.email,
        profile.role,
        profile.subscription_tier,
        profile.is_active,
        profile.last_login_at,
        profile.last_login_ip,
        profile.created_at,
        COALESCE(grants.active_grant_count, 0)::BIGINT,
        grants.latest_access_expires_at
    FROM public.profiles profile
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*)::BIGINT AS active_grant_count,
            MAX(grant_row.expires_at) FILTER (WHERE grant_row.expires_at IS NOT NULL) AS latest_access_expires_at
        FROM public.user_access_grants grant_row
        WHERE grant_row.user_id = profile.id
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= now()
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
    ) grants ON TRUE
    WHERE (v_role IS NULL OR profile.role = v_role)
      AND (p_is_active IS NULL OR profile.is_active = p_is_active)
      AND (
          v_search IS NULL
          OR profile.email ILIKE '%' || v_search || '%'
          OR COALESCE(profile.full_name, '') ILIKE '%' || v_search || '%'
          OR profile.id::TEXT = v_search
      )
    ORDER BY profile.created_at DESC, profile.id
    LIMIT v_limit
    OFFSET v_offset;
END;
$$;

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
