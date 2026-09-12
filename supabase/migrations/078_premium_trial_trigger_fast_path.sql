-- Fast-path premium exam-session inserts through the legacy free-trial triggers.
--
-- Production profiling showed that every Create INSERT currently enters the trial
-- quota trigger even for users with an active premium bank grant. The trigger takes
-- a transaction advisory lock before discovering that the user is premium, then a
-- second AFTER INSERT trigger performs another bank lookup before repeating the same
-- premium access check.
--
-- Preserve all trial semantics and security boundaries while removing that work from
-- the dominant premium path:
-- - authenticated user/session ownership is still checked first
-- - premium access is still evaluated from the live access-grant tables
-- - trial users still require an active profile, take the same advisory lock, and
--   enforce the same persistent block ledger
-- - revocation remains fail-safe because create_exam_session_bootstrap performs fresh
--   post-insert access checks; any failure rolls the INSERT and its triggers back

CREATE OR REPLACE FUNCTION public.enforce_free_trial_session_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    trial_enabled BOOLEAN;
    block_limit INT;
    used_blocks BIGINT;
    has_premium BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    -- Resolve entitlement before taking the trial-only serialization lock. The
    -- helper includes the active-profile check, so a TRUE result is sufficient for
    -- the premium path and avoids duplicate is_active_user() work.
    SELECT public.has_premium_question_bank_access(NEW.question_bank_id)
    INTO has_premium;

    IF has_premium THEN
        RETURN NEW;
    END IF;

    -- Non-premium users may proceed only as active free-trial users.
    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Account is inactive';
    END IF;

    SELECT qb.is_free_trial, qb.free_trial_block_limit
    INTO trial_enabled, block_limit
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    IF NOT trial_enabled THEN
        RAISE EXCEPTION 'Premium access required for this question bank';
    END IF;

    IF block_limit IS NULL THEN
        RAISE EXCEPTION 'Free-trial bank is missing a block limit';
    END IF;

    -- Only trial users need serialization around quota consumption.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.user_id::text || ':' || NEW.question_bank_id::text, 0)
    );

    SELECT COUNT(*) INTO used_blocks
    FROM public.free_trial_block_usage usage_row
    WHERE usage_row.user_id = NEW.user_id
      AND usage_row.question_bank_id = NEW.question_bank_id;

    IF used_blocks >= block_limit THEN
        RAISE EXCEPTION 'Free-trial block quota exhausted';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_free_trial_session_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET row_security TO 'off'
AS $function$
DECLARE
    is_trial BOOLEAN;
    has_premium BOOLEAN;
BEGIN
    -- Premium sessions never consume the free-trial ledger. Check this first so the
    -- common path avoids an additional standalone question_banks lookup.
    SELECT public.has_premium_question_bank_access(NEW.question_bank_id)
    INTO has_premium;

    IF has_premium THEN
        RETURN NEW;
    END IF;

    SELECT qb.is_free_trial
    INTO is_trial
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    IF is_trial THEN
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
$function$;

COMMENT ON FUNCTION public.enforce_free_trial_session_quota() IS
    'Enforces trial block quota; premium sessions bypass trial-only advisory locking after live entitlement validation.';

COMMENT ON FUNCTION public.record_free_trial_session_usage() IS
    'Records persistent free-trial usage; premium sessions return before trial ledger work.';
