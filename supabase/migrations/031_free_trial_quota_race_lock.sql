-- Serialize free-trial session creation per user/bank so concurrent requests cannot
-- both observe the same remaining quota.

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
    -- Transaction-scoped lock derived from user + bank. The text hash is stable for
    -- the transaction and prevents concurrent quota checks for the same pair.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || NEW.question_bank_id::text, 0));

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
