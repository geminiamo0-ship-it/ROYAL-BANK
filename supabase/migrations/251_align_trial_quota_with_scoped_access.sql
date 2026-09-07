-- Keep free-trial quota enforcement aligned with the authoritative scoped
-- premium-access model introduced in 250_scoped_access_grants.sql.
-- Premium users must never consume trial quota merely because the bank also
-- happens to be configured as a free-trial bank.

CREATE OR REPLACE FUNCTION public.enforce_free_trial_session_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    trial_enabled BOOLEAN;
    block_limit INT;
    used_blocks BIGINT;
    has_premium BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Account is inactive';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.user_id::text || ':' || NEW.question_bank_id::text, 0)
    );

    SELECT qb.is_free_trial, qb.free_trial_block_limit
    INTO trial_enabled, block_limit
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    SELECT public.has_premium_question_bank_access(NEW.question_bank_id)
    INTO has_premium;

    IF has_premium THEN
        RETURN NEW;
    END IF;

    IF NOT trial_enabled THEN
        RAISE EXCEPTION 'Premium access required for this question bank';
    END IF;

    IF block_limit IS NULL THEN
        RAISE EXCEPTION 'Free-trial bank is missing a block limit';
    END IF;

    SELECT COUNT(*) INTO used_blocks
    FROM public.free_trial_block_usage usage_row
    WHERE usage_row.user_id = NEW.user_id
      AND usage_row.question_bank_id = NEW.question_bank_id;

    IF used_blocks >= block_limit THEN
        RAISE EXCEPTION 'Free-trial block quota exhausted';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_free_trial_session_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
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

REVOKE ALL ON FUNCTION public.enforce_free_trial_session_quota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_free_trial_session_usage() FROM PUBLIC;

COMMENT ON FUNCTION public.enforce_free_trial_session_quota() IS
'Enforces non-refundable free-trial block quota only when the authenticated user lacks active scoped premium access to the bank.';

COMMENT ON FUNCTION public.record_free_trial_session_usage() IS
'Records a trial-block ledger entry only for non-premium users; scoped premium users never consume trial quota.';
