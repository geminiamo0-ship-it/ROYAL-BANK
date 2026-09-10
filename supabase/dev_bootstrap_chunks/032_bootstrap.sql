CREATE OR REPLACE FUNCTION public.admin_unblock_ip(p_ip INET, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_row public.ip_blocklist%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED'; END IF;
    IF p_ip IS NULL THEN RAISE EXCEPTION 'IP_REQUIRED'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN RAISE EXCEPTION 'UNBLOCK_REASON_REQUIRED'; END IF;

    DELETE FROM public.ip_blocklist WHERE ip_address = p_ip RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'IP_BLOCK_NOT_FOUND'; END IF;

    PERFORM private.business_audit(
        'security_ip_unblocked', 'ip_blocklist', v_row.id::TEXT,
        jsonb_build_object('ip_address', v_row.ip_address, 'reason', v_reason)
    );

    RETURN jsonb_build_object('id', v_row.id, 'ip_address', v_row.ip_address, 'status', 'unblocked');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_manual_review(
    p_user_id UUID,
    p_required BOOLEAN,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
    v_state private.exam_security_account_state%ROWTYPE;
BEGIN
    IF NOT private.business_is_admin() THEN RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED'; END IF;
    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
    IF p_required IS NULL THEN RAISE EXCEPTION 'REVIEW_STATE_REQUIRED'; END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN RAISE EXCEPTION 'REVIEW_REASON_REQUIRED'; END IF;

    INSERT INTO private.exam_security_account_state(
        user_id, manual_review_required, manual_review_reason, risk_score, updated_at
    ) VALUES (
        p_user_id, p_required, CASE WHEN p_required THEN v_reason ELSE NULL END, 0, clock_timestamp()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET manual_review_required = EXCLUDED.manual_review_required,
        manual_review_reason = EXCLUDED.manual_review_reason,
        updated_at = clock_timestamp()
    RETURNING * INTO v_state;

    PERFORM private.business_audit(
        CASE WHEN p_required THEN 'security_manual_review_required' ELSE 'security_manual_review_cleared' END,
        'user', p_user_id::TEXT,
        jsonb_build_object('reason', v_reason, 'risk_score', v_state.risk_score)
    );

    RETURN jsonb_build_object(
        'user_id', v_state.user_id,
        'manual_review_required', v_state.manual_review_required,
        'manual_review_reason', v_state.manual_review_reason,
        'risk_score', v_state.risk_score,
        'updated_at', v_state.updated_at
    );
END;
$$;

-- Force blocklist mutations through audited RPCs.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ip_blocklist FROM authenticated;

REVOKE ALL ON FUNCTION public.admin_get_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_get_security_risk(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_block_ip(INET, TEXT) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_unblock_ip(INET, TEXT) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_set_manual_review(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_product_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_get_security_risk(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_block_ip(INET, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_unblock_ip(INET, TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_set_manual_review(UUID, BOOLEAN, TEXT) TO authenticated;

-- Release D trial analytics correctness follow-up.
-- Split the calculation into private helpers so bank-level usage cannot be multiplied
-- by unrelated cohort rows when a bank has multiple starters.

CREATE OR REPLACE FUNCTION private.admin_trial_summary(
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
    WITH first_trial AS (
        SELECT DISTINCT ON (usage.user_id)
            usage.user_id,
            usage.question_bank_id,
            usage.consumed_at AS first_trial_at
        FROM public.free_trial_block_usage usage
        ORDER BY usage.user_id, usage.consumed_at, usage.id
    ),
    cohort AS (
        SELECT * FROM first_trial
        WHERE first_trial_at >= p_from AND first_trial_at < p_to
    ),
    cohort_conversion AS (
        SELECT
            cohort.user_id,
            cohort.first_trial_at,
            (
                SELECT MIN(request_row.activated_at)
                FROM public.upgrade_requests request_row
                WHERE request_row.user_id = cohort.user_id
                  AND request_row.status = 'activated'
                  AND request_row.activated_at >= cohort.first_trial_at
                  AND request_row.activated_at < p_to
            ) AS converted_at
        FROM cohort
    ),
    active_trial_users AS (
        SELECT DISTINCT usage.user_id
        FROM public.free_trial_block_usage usage
        WHERE usage.consumed_at >= p_from AND usage.consumed_at < p_to
    ),
    cumulative_bank_usage AS (
        SELECT usage.user_id, usage.question_bank_id, COUNT(*)::BIGINT AS blocks_used
        FROM public.free_trial_block_usage usage
        JOIN active_trial_users active_user ON active_user.user_id = usage.user_id
        WHERE usage.consumed_at < p_to
        GROUP BY usage.user_id, usage.question_bank_id
    ),
    exhausted AS (
        SELECT DISTINCT bank_usage.user_id
        FROM cumulative_bank_usage bank_usage
        JOIN public.question_banks bank ON bank.id = bank_usage.question_bank_id
        WHERE bank.is_free_trial IS TRUE
          AND bank.free_trial_block_limit IS NOT NULL
          AND bank_usage.blocks_used >= bank.free_trial_block_limit
    )
    SELECT jsonb_build_object(
        'trial_starters', (SELECT COUNT(*) FROM cohort),
        'active_trial_users', (SELECT COUNT(*) FROM active_trial_users),
        'trial_blocks_consumed', (
            SELECT COUNT(*) FROM public.free_trial_block_usage usage
            WHERE usage.consumed_at >= p_from AND usage.consumed_at < p_to
        ),
        'trial_sessions_started', (
            SELECT COUNT(*)
            FROM public.test_sessions session_row
            JOIN public.question_banks bank ON bank.id = session_row.question_bank_id
            WHERE bank.is_free_trial IS TRUE
              AND session_row.started_at >= p_from AND session_row.started_at < p_to
        ),
        'trial_questions_answered', (
            SELECT COUNT(*)
            FROM public.user_answers answer_row
            JOIN public.test_sessions session_row ON session_row.id = answer_row.test_session_id
            JOIN public.question_banks bank ON bank.id = session_row.question_bank_id
            WHERE bank.is_free_trial IS TRUE
              AND answer_row.answered_at >= p_from AND answer_row.answered_at < p_to
        ),
        'exhausted_trial_users', (SELECT COUNT(*) FROM exhausted),
        'converted_users', (SELECT COUNT(*) FROM cohort_conversion WHERE converted_at IS NOT NULL),
        'conversion_rate_percent', (
            SELECT CASE WHEN COUNT(*) = 0 THEN 0
                ELSE round(100.0 * COUNT(*) FILTER (WHERE converted_at IS NOT NULL) / COUNT(*), 1)
            END
            FROM cohort_conversion
        ),
        'avg_hours_to_convert', (
            SELECT round(avg(extract(epoch FROM (converted_at - first_trial_at)) / 3600.0)::NUMERIC, 1)
            FROM cohort_conversion
            WHERE converted_at IS NOT NULL
        )
    );
$$;

CREATE OR REPLACE FUNCTION private.admin_trial_bank_breakdown(
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
    WITH first_trial AS (
        SELECT DISTINCT ON (usage.user_id)
            usage.user_id,
            usage.question_bank_id,
            usage.consumed_at AS first_trial_at
        FROM public.free_trial_block_usage usage
        ORDER BY usage.user_id, usage.consumed_at, usage.id
    ),
    bank_rows AS (
        SELECT
            bank.id,
            bank.name,
            bank.free_trial_block_limit,
            bank.free_trial_question_limit,
            (
                SELECT COUNT(*)
                FROM first_trial first_row
                WHERE first_row.question_bank_id = bank.id
                  AND first_row.first_trial_at >= p_from
                  AND first_row.first_trial_at < p_to
            )::BIGINT AS starters,
            (
                SELECT COUNT(DISTINCT usage.user_id)
                FROM public.free_trial_block_usage usage
                WHERE usage.question_bank_id = bank.id
                  AND usage.consumed_at >= p_from
                  AND usage.consumed_at < p_to
            )::BIGINT AS active_users,
            (
                SELECT COUNT(*)
                FROM public.free_trial_block_usage usage
                WHERE usage.question_bank_id = bank.id
                  AND usage.consumed_at >= p_from
                  AND usage.consumed_at < p_to
            )::BIGINT AS blocks_consumed,
            (
                SELECT COUNT(*)
                FROM first_trial first_row
                WHERE first_row.question_bank_id = bank.id
                  AND first_row.first_trial_at >= p_from
                  AND first_row.first_trial_at < p_to
                  AND EXISTS (
                      SELECT 1
                      FROM public.upgrade_requests request_row
                      WHERE request_row.user_id = first_row.user_id
                        AND request_row.status = 'activated'
                        AND request_row.activated_at >= first_row.first_trial_at
                        AND request_row.activated_at < p_to
                  )
            )::BIGINT AS converted_users
        FROM public.question_banks bank
        WHERE bank.is_free_trial IS TRUE
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'bank_id', row_data.id,
                'bank_name', row_data.name,
                'block_limit', row_data.free_trial_block_limit,
                'question_limit', row_data.free_trial_question_limit,
                'starters', row_data.starters,
                'active_users', row_data.active_users,
                'blocks_consumed', row_data.blocks_consumed,
                'converted_users', row_data.converted_users,
                'conversion_rate_percent', CASE WHEN row_data.starters = 0 THEN 0
                    ELSE round(100.0 * row_data.converted_users / row_data.starters, 1)
                END
            )
            ORDER BY row_data.active_users DESC, row_data.name
        ),
        '[]'::jsonb
    )
    FROM bank_rows row_data;
$$;

CREATE OR REPLACE FUNCTION private.admin_trial_daily(
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
    WITH days AS (
        SELECT generate_series(
            date_trunc('day', p_from),
            date_trunc('day', p_to - interval '1 microsecond'),
            interval '1 day'
        ) AS day_start
    ),
    first_trial AS (
        SELECT usage.user_id, MIN(usage.consumed_at) AS first_trial_at
        FROM public.free_trial_block_usage usage
        GROUP BY usage.user_id
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'date', day_start::date,
                'active_users', (
                    SELECT COUNT(DISTINCT usage.user_id)
                    FROM public.free_trial_block_usage usage
                    WHERE usage.consumed_at >= day_start
                      AND usage.consumed_at < day_start + interval '1 day'
                ),
                'new_starters', (
                    SELECT COUNT(*)
                    FROM first_trial first_row
                    WHERE first_row.first_trial_at >= day_start
                      AND first_row.first_trial_at < day_start + interval '1 day'
                ),
                'blocks_consumed', (
                    SELECT COUNT(*)
                    FROM public.free_trial_block_usage usage
                    WHERE usage.consumed_at >= day_start
                      AND usage.consumed_at < day_start + interval '1 day'
                ),
                'conversions', (
                    SELECT COUNT(DISTINCT request_row.user_id)
                    FROM public.upgrade_requests request_row
                    WHERE request_row.status = 'activated'
                      AND request_row.activated_at >= day_start
                      AND request_row.activated_at < day_start + interval '1 day'
                      AND EXISTS (
                          SELECT 1
                          FROM first_trial first_row
                          WHERE first_row.user_id = request_row.user_id
                            AND first_row.first_trial_at <= request_row.activated_at
                      )
                )
            ) ORDER BY day_start
        ),
        '[]'::jsonb
    )
    FROM days;
$$;

REVOKE ALL ON FUNCTION private.admin_trial_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.admin_trial_bank_breakdown(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION private.admin_trial_daily(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_trial_analytics(
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
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '366 days' THEN
        RAISE EXCEPTION 'INVALID_REPORT_WINDOW';
    END IF;

    RETURN jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'summary', private.admin_trial_summary(p_from, p_to),
        'by_bank', private.admin_trial_bank_breakdown(p_from, p_to),
        'daily', private.admin_trial_daily(p_from, p_to)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_trial_analytics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_trial_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
