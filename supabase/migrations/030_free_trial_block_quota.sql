-- Database-side quota guard for configurable free-trial banks. This is enforced
-- independently of the frontend so direct API/RPC calls cannot exceed the quota.

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
    SELECT qb.is_free_trial, qb.free_trial_block_limit
    INTO trial_enabled, block_limit
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.question_banks qb
        JOIN public.user_pathway_access upa
          ON upa.pathway_id = qb.pathway_id
        WHERE qb.id = NEW.question_bank_id
          AND upa.user_id = NEW.user_id
          AND upa.access_type = 'premium'
          AND (upa.expires_at IS NULL OR upa.expires_at > now())
    ) INTO has_premium;

    IF has_premium OR public.is_support_or_admin() THEN
        RETURN NEW;
    END IF;

    IF NOT trial_enabled THEN
        RAISE EXCEPTION 'Premium access required for this question bank';
    END IF;

    IF block_limit IS NULL THEN
        RAISE EXCEPTION 'Free-trial bank is missing a block limit';
    END IF;

    SELECT COUNT(*)
    INTO used_blocks
    FROM public.test_sessions ts
    WHERE ts.user_id = NEW.user_id
      AND ts.question_bank_id = NEW.question_bank_id;

    IF used_blocks >= block_limit THEN
        RAISE EXCEPTION 'Free-trial block quota exhausted';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_free_trial_session_quota_trigger ON public.test_sessions;
CREATE TRIGGER enforce_free_trial_session_quota_trigger
    BEFORE INSERT ON public.test_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_free_trial_session_quota();

REVOKE ALL ON FUNCTION public.enforce_free_trial_session_quota() FROM PUBLIC;
