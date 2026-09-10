SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

CREATE OR REPLACE FUNCTION private.release_completed_exam_session_lease()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NEW.is_completed IS TRUE AND OLD.is_completed IS DISTINCT FROM TRUE THEN
        DELETE FROM private.exam_session_leases
        WHERE session_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z0_release_completed_exam_session_lease_trigger ON public.test_sessions;

CREATE TRIGGER z0_release_completed_exam_session_lease_trigger
AFTER UPDATE OF is_completed ON public.test_sessions
FOR EACH ROW
EXECUTE FUNCTION private.release_completed_exam_session_lease();

CREATE OR REPLACE FUNCTION private.authorize_and_record_question_window(
    p_user_id UUID,
    p_bank_id BIGINT,
    p_session_id UUID,
    p_start INTEGER,
    p_count INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_cfg private.exam_security_config%ROWTYPE;
    v_state private.exam_security_account_state%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_candidate_count INTEGER := 0;
    v_requested_first_new INTEGER;
    v_frontier INTEGER;
    v_count_15m INTEGER := 0;
    v_count_24h INTEGER := 0;
    v_new_budget INTEGER := 0;
    v_new_accepted INTEGER := 0;
    v_effective_count INTEGER := 0;
    v_inserted INTEGER := 0;
    v_after_15m INTEGER := 0;
    v_after_24h INTEGER := 0;
    v_block_code TEXT;
    v_block_until TIMESTAMPTZ;
    v_today_cairo DATE;
    v_last_cap_date DATE;
    v_previous_streak INTEGER := 0;
    v_new_streak INTEGER := 1;
    v_row RECORD;
BEGIN
    IF p_user_id IS NULL OR p_session_id IS NULL OR p_bank_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_EXAM_SECURITY_CONTEXT';
    END IF;

    IF p_start IS NULL OR p_start < 0 OR p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'INVALID_QUESTION_WINDOW';
    END IF;

    SELECT * INTO v_cfg
    FROM private.exam_security_config
    WHERE singleton = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXAM_SECURITY_CONFIG_MISSING';
    END IF;

    IF NOT private.try_exam_security_lock(p_user_id) THEN
        RAISE EXCEPTION 'SECURITY_CONCURRENCY_BUSY';
    END IF;

    PERFORM private.touch_exam_session_lease(p_user_id, p_session_id, v_now);

    SELECT
        count(*)::integer,
        MIN(tsq.sort_order) FILTER (WHERE d.question_id IS NULL)
    INTO v_candidate_count, v_requested_first_new
    FROM public.test_session_questions tsq
    LEFT JOIN private.question_disclosures d
      ON d.user_id = p_user_id
     AND d.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + p_count;

    IF v_candidate_count = 0 THEN
        RETURN 0;
    END IF;

    IF NOT v_cfg.question_enforcement_enabled THEN
        RETURN p_count;
    END IF;

    -- Requests containing only content already disclosed to this user remain usable
    -- even during cooldown/manual-review states.
    IF v_requested_first_new IS NULL THEN
        RETURN p_count;
    END IF;

    SELECT MIN(tsq.sort_order)
    INTO v_frontier
    FROM public.test_session_questions tsq
    LEFT JOIN private.question_disclosures d
      ON d.user_id = p_user_id
     AND d.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND d.question_id IS NULL;

    IF v_frontier IS NULL OR v_requested_first_new <> v_frontier THEN
        RAISE EXCEPTION 'QUESTION_WINDOW_OUT_OF_SEQUENCE';
    END IF;

    SELECT * INTO v_state
    FROM private.exam_security_account_state state
    WHERE state.user_id = p_user_id;

    IF FOUND AND v_state.manual_review_required THEN
        v_new_budget := 0;
        v_block_code := 'MANUAL_REVIEW_REQUIRED';
    ELSIF FOUND
       AND v_state.question_blocked_until IS NOT NULL
       AND v_state.question_blocked_until > v_now THEN
        v_new_budget := 0;
        v_block_code := COALESCE(v_state.question_block_reason, 'QUESTION_ACCESS_COOLDOWN');
    ELSE
        SELECT count(*) INTO v_count_15m
        FROM (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = p_user_id
              AND d.first_disclosed_at >= GREATEST(
                  v_cfg.policy_started_at,
                  v_now - v_cfg.question_burst_window
              )
            ORDER BY d.first_disclosed_at DESC
            LIMIT v_cfg.question_burst_limit
        ) bounded_burst;

        SELECT count(*) INTO v_count_24h
        FROM (
            SELECT 1
            FROM private.question_disclosures d
            WHERE d.user_id = p_user_id
              AND d.first_disclosed_at >= GREATEST(
                  v_cfg.policy_started_at,
                  v_now - v_cfg.question_daily_window
              )
            ORDER BY d.first_disclosed_at DESC
            LIMIT v_cfg.question_daily_limit
        ) bounded_daily;

        v_new_budget := LEAST(
            v_cfg.max_new_questions_per_window,
            GREATEST(v_cfg.question_daily_limit - v_count_24h, 0)
        );

        IF v_count_24h >= v_cfg.question_daily_limit THEN
            v_new_budget := 0;
            v_block_code := 'DAILY_CONTENT_LIMIT';
        END IF;

        IF v_count_15m >= v_cfg.question_burst_limit THEN
            v_new_budget := 0;
            v_block_code := COALESCE(v_block_code, 'QUESTION_ACCESS_COOLDOWN');
        ELSE
            v_new_budget := LEAST(
                v_new_budget,
                v_cfg.question_burst_limit - v_count_15m
            );
        END IF;

        -- 300 is a one-time crossing cooldown while the rolling count remains above
        -- 300. Once the 3h cooldown expires, the user may continue toward 650.
        IF v_count_24h < v_cfg.question_soft_limit THEN
            v_new_budget := LEAST(
                v_new_budget,
                v_cfg.question_soft_limit - v_count_24h
            );
        END IF;
    END IF;

    -- Return the largest PREFIX of the requested range that does not disclose more
    -- fresh questions than the current budget. This prevents 59 -> 62, 299 -> 302,
    -- or 649 -> 652 overshoots while still returning any already-disclosed prefix.
    FOR v_row IN
        SELECT
            tsq.sort_order,
            tsq.question_id,
            (d.question_id IS NULL) AS is_new
        FROM public.test_session_questions tsq
        LEFT JOIN private.question_disclosures d
          ON d.user_id = p_user_id
         AND d.question_id = tsq.question_id
        WHERE tsq.test_session_id = p_session_id
          AND tsq.sort_order >= p_start
          AND tsq.sort_order < p_start + p_count
        ORDER BY tsq.sort_order
    LOOP
        IF v_row.is_new THEN
            IF v_new_accepted >= v_new_budget THEN
                EXIT;
            END IF;
            v_new_accepted := v_new_accepted + 1;
        END IF;

        -- Core windowing is expressed as a sort-order span, not row count.
        v_effective_count := v_row.sort_order - p_start + 1;
    END LOOP;

    IF v_effective_count <= 0 THEN
        RAISE EXCEPTION '%', COALESCE(v_block_code, 'QUESTION_ACCESS_COOLDOWN');
    END IF;

    INSERT INTO private.question_disclosures(
        user_id,
        question_id,
        first_bank_id,
        first_session_id,
        first_disclosed_at
    )
    SELECT
        p_user_id,
        tsq.question_id,
        p_bank_id,
        p_session_id,
        v_now
    FROM public.test_session_questions tsq
    LEFT JOIN private.question_disclosures d
      ON d.user_id = p_user_id
     AND d.question_id = tsq.question_id
    WHERE tsq.test_session_id = p_session_id
      AND tsq.sort_order >= p_start
      AND tsq.sort_order < p_start + v_effective_count
      AND d.question_id IS NULL
    ORDER BY tsq.sort_order
    ON CONFLICT (user_id, question_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_inserted > 0 THEN
        v_after_15m := v_count_15m + v_inserted;
        v_after_24h := v_count_24h + v_inserted;

        IF v_count_15m < v_cfg.question_burst_limit
           AND v_after_15m >= v_cfg.question_burst_limit THEN
            v_block_until := v_now + v_cfg.question_burst_block;

            INSERT INTO private.exam_security_account_state(
                user_id,
                question_blocked_until,
                question_block_reason,
                risk_score,
                updated_at
            ) VALUES (
                p_user_id,
                v_block_until,
                'QUESTION_ACCESS_COOLDOWN',
                5,
                v_now
            )
            ON CONFLICT (user_id) DO UPDATE
            SET
                question_block_reason = CASE
                    WHEN exam_security_account_state.question_blocked_until IS NULL
                      OR exam_security_account_state.question_blocked_until < EXCLUDED.question_blocked_until
                    THEN EXCLUDED.question_block_reason
                    ELSE exam_security_account_state.question_block_reason
                END,
                question_blocked_until = GREATEST(
                    COALESCE(exam_security_account_state.question_blocked_until, '-infinity'::timestamptz),
                    EXCLUDED.question_blocked_until
                ),
                risk_score = LEAST(100, exam_security_account_state.risk_score + 5),
                updated_at = v_now;

            INSERT INTO private.exam_security_events(
                user_id, event_type, question_bank_id, session_id, metadata
            ) VALUES (
                p_user_id,
                'question_burst_limit_reached',
                p_bank_id,
                p_session_id,
                jsonb_build_object('limit', v_cfg.question_burst_limit)
            );
        END IF;

        IF v_count_24h < v_cfg.question_soft_limit
           AND v_after_24h >= v_cfg.question_soft_limit THEN
            v_block_until := v_now + v_cfg.question_soft_block;

            INSERT INTO private.exam_security_account_state(
                user_id,
                question_blocked_until,
                question_block_reason,
                session_create_blocked_until,
                session_create_block_reason,
                risk_score,
                updated_at
            ) VALUES (
                p_user_id,
                v_block_until,
                'QUESTION_ACCESS_COOLDOWN',
                v_block_until,
                'QUESTION_ACCESS_COOLDOWN',
                20,
                v_now
            )
            ON CONFLICT (user_id) DO UPDATE
            SET
                question_block_reason = CASE
                    WHEN exam_security_account_state.question_blocked_until IS NULL
                      OR exam_security_account_state.question_blocked_until < EXCLUDED.question_blocked_until
                    THEN EXCLUDED.question_block_reason
                    ELSE exam_security_account_state.question_block_reason
                END,
                question_blocked_until = GREATEST(
                    COALESCE(exam_security_account_state.question_blocked_until, '-infinity'::timestamptz),
                    EXCLUDED.question_blocked_until
                ),
                session_create_block_reason = CASE
                    WHEN exam_security_account_state.session_create_blocked_until IS NULL
                      OR exam_security_account_state.session_create_blocked_until < EXCLUDED.session_create_blocked_until
                    THEN EXCLUDED.session_create_block_reason
                    ELSE exam_security_account_state.session_create_block_reason
                END,
                session_create_blocked_until = GREATEST(
                    COALESCE(exam_security_account_state.session_create_blocked_until, '-infinity'::timestamptz),
                    EXCLUDED.session_create_blocked_until
                ),
                risk_score = LEAST(100, exam_security_account_state.risk_score + 20),
                updated_at = v_now;

            INSERT INTO private.exam_security_events(
                user_id, event_type, question_bank_id, session_id, metadata
            ) VALUES (
                p_user_id,
                'question_300_cooldown_reached',
                p_bank_id,
                p_session_id,
                jsonb_build_object('limit', v_cfg.question_soft_limit)
            );
        END IF;

        IF v_count_24h < v_cfg.question_daily_limit
           AND v_after_24h >= v_cfg.question_daily_limit THEN
            v_today_cairo := (v_now AT TIME ZONE 'Africa/Cairo')::date;

            SELECT
                state.last_question_cap_cairo_date,
                state.consecutive_question_cap_days
            INTO v_last_cap_date, v_previous_streak
            FROM private.exam_security_account_state state
            WHERE state.user_id = p_user_id;

            IF v_last_cap_date IS DISTINCT FROM v_today_cairo THEN
                IF v_last_cap_date = v_today_cairo - 1 THEN
                    v_new_streak := COALESCE(v_previous_streak, 0) + 1;
                ELSE
                    v_new_streak := 1;
                END IF;

                INSERT INTO private.exam_security_account_state(
                    user_id,
                    last_question_cap_cairo_date,
                    consecutive_question_cap_days,
                    risk_score,
                    updated_at
                ) VALUES (
                    p_user_id,
                    v_today_cairo,
                    v_new_streak,
                    50,
                    v_now
                )
                ON CONFLICT (user_id) DO UPDATE
                SET
                    last_question_cap_cairo_date = EXCLUDED.last_question_cap_cairo_date,
                    consecutive_question_cap_days = EXCLUDED.consecutive_question_cap_days,
                    risk_score = LEAST(100, exam_security_account_state.risk_score + 50),
                    updated_at = v_now;

                INSERT INTO private.exam_security_events(
                    user_id, event_type, question_bank_id, session_id, metadata
                ) VALUES (
                    p_user_id,
                    'question_daily_cap_reached',
                    p_bank_id,
                    p_session_id,
                    jsonb_build_object(
                        'limit', v_cfg.question_daily_limit,
                        'cairo_date', v_today_cairo,
                        'consecutive_days', v_new_streak
                    )
                );

                IF v_new_streak >= 2 THEN
                    UPDATE private.exam_security_account_state
                    SET
                        manual_review_required = TRUE,
                        manual_review_reason = 'REPEATED_DAILY_CONTENT_LIMIT',
                        updated_at = v_now
                    WHERE user_id = p_user_id;

                    INSERT INTO private.exam_security_events(
                        user_id, event_type, question_bank_id, session_id, metadata
                    ) VALUES (
                        p_user_id,
                        'manual_review_lock',
                        p_bank_id,
                        p_session_id,
                        jsonb_build_object('reason', 'REPEATED_DAILY_CONTENT_LIMIT')
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN v_effective_count;
END;
$$;

-- Keep the proven safe-payload implementation unchanged by moving it behind a
-- security wrapper rather than rewriting its answer-secrecy query.
ALTER FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    SET SCHEMA private;

ALTER FUNCTION private.get_exam_session_window(UUID, INTEGER, INTEGER)
    RENAME TO get_exam_session_window_core;

REVOKE ALL ON FUNCTION private.get_exam_session_window_core(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_exam_session_window(
    p_session_id UUID,
    p_start INTEGER DEFAULT 0,
    p_count INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_session public.test_sessions;
    v_effective_count INTEGER;
BEGIN
    IF v_user_id IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Active authentication required';
    END IF;

    IF p_start IS NULL OR p_start < 0 THEN
        RAISE EXCEPTION 'Window start must be zero or greater';
    END IF;

    IF p_count IS NULL OR p_count < 1 OR p_count > 5 THEN
        RAISE EXCEPTION 'Window count must be between 1 and 5';
    END IF;

    SELECT * INTO v_session
    FROM public.test_sessions ts
    WHERE ts.id = p_session_id
      AND ts.user_id = v_user_id;

    IF v_session.id IS NULL THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.is_completed THEN
        RAISE EXCEPTION 'Session is completed';
    END IF;

    IF NOT public.can_access_question_bank(v_session.question_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    v_effective_count := private.authorize_and_record_question_window(
        v_user_id,
        v_session.question_bank_id,
        p_session_id,
        p_start,
        p_count
    );

    IF v_effective_count <= 0 THEN
        RETURN '[]'::jsonb;
    END IF;

    -- Core performs its original fresh auth/ownership/access checks again before
    -- reading content. Do not collapse this boundary into the earlier checks.
    RETURN private.get_exam_session_window_core(
        p_session_id,
        p_start,
        v_effective_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_session_window(UUID, INTEGER, INTEGER)
    FROM PUBLIC, anon;
