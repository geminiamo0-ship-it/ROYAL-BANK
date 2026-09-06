-- Trial consumption is historical and must not be refunded by deleting a session.
-- Record each successfully created trial block in a ledger independent of sessions.

CREATE TABLE IF NOT EXISTS public.free_trial_block_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    question_bank_id BIGINT NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
    test_session_id UUID NOT NULL UNIQUE,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.free_trial_block_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trial usage"
    ON public.free_trial_block_usage FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_free_trial_usage_user_bank
    ON public.free_trial_block_usage(user_id, question_bank_id);

-- Existing sessions count as already-consumed trial blocks.
INSERT INTO public.free_trial_block_usage (user_id, question_bank_id, test_session_id, consumed_at)
SELECT ts.user_id, ts.question_bank_id, ts.id, ts.started_at
FROM public.test_sessions ts
JOIN public.question_banks qb ON qb.id = ts.question_bank_id
WHERE qb.is_free_trial = TRUE
ON CONFLICT (test_session_id) DO NOTHING;

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
        JOIN public.user_pathway_access upa ON upa.pathway_id = qb.pathway_id
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

    SELECT COUNT(*) INTO used_blocks
    FROM public.free_trial_block_usage u
    WHERE u.user_id = NEW.user_id
      AND u.question_bank_id = NEW.question_bank_id;

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
    SELECT qb.is_free_trial INTO is_trial
    FROM public.question_banks qb
    WHERE qb.id = NEW.question_bank_id;

    SELECT EXISTS (
        SELECT 1
        FROM public.question_banks qb
        JOIN public.user_pathway_access upa ON upa.pathway_id = qb.pathway_id
        WHERE qb.id = NEW.question_bank_id
          AND upa.user_id = NEW.user_id
          AND upa.access_type = 'premium'
          AND (upa.expires_at IS NULL OR upa.expires_at > now())
    ) INTO has_premium;

    IF is_trial AND NOT has_premium THEN
        INSERT INTO public.free_trial_block_usage (user_id, question_bank_id, test_session_id)
        VALUES (NEW.user_id, NEW.question_bank_id, NEW.id)
        ON CONFLICT (test_session_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_free_trial_session_usage_trigger ON public.test_sessions;
CREATE TRIGGER record_free_trial_session_usage_trigger
    AFTER INSERT ON public.test_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.record_free_trial_session_usage();

REVOKE ALL ON FUNCTION public.record_free_trial_session_usage() FROM PUBLIC;
