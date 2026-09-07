-- Unified premium access model.
-- A grant can cover the whole site, a pathway (including future banks), or one bank.
-- expires_at = NULL means lifetime access. Existing pathway premium rows are
-- backfilled for compatibility while admin tooling moves to this model.

CREATE TABLE IF NOT EXISTS public.user_access_grants (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'pathway', 'bank')),
    pathway_id BIGINT REFERENCES public.pathways(id) ON DELETE CASCADE,
    question_bank_id BIGINT REFERENCES public.question_banks(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_access_grants_scope_shape CHECK (
        (scope_type = 'global' AND pathway_id IS NULL AND question_bank_id IS NULL)
        OR (scope_type = 'pathway' AND pathway_id IS NOT NULL AND question_bank_id IS NULL)
        OR (scope_type = 'bank' AND pathway_id IS NULL AND question_bank_id IS NOT NULL)
    ),
    CONSTRAINT user_access_grants_expiry_check CHECK (
        expires_at IS NULL OR expires_at > starts_at
    )
);

CREATE INDEX IF NOT EXISTS idx_user_access_grants_user_active
    ON public.user_access_grants(user_id, scope_type, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_access_grants_pathway
    ON public.user_access_grants(pathway_id, user_id)
    WHERE scope_type = 'pathway';
CREATE INDEX IF NOT EXISTS idx_user_access_grants_bank
    ON public.user_access_grants(question_bank_id, user_id)
    WHERE scope_type = 'bank';

ALTER TABLE public.user_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own scoped access" ON public.user_access_grants;
CREATE POLICY "Users can view own scoped access"
    ON public.user_access_grants
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id OR public.is_support_or_admin());

REVOKE INSERT, UPDATE, DELETE ON public.user_access_grants FROM anon, authenticated;
GRANT SELECT ON public.user_access_grants TO authenticated;

INSERT INTO public.user_access_grants (
    user_id,
    scope_type,
    pathway_id,
    starts_at,
    expires_at,
    granted_by,
    created_at
)
SELECT
    upa.user_id,
    'pathway',
    upa.pathway_id,
    COALESCE(upa.granted_at, now()),
    upa.expires_at,
    upa.granted_by,
    COALESCE(upa.granted_at, now())
FROM public.user_pathway_access upa
WHERE upa.access_type = 'premium'
  AND upa.pathway_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.user_access_grants existing
      WHERE existing.user_id = upa.user_id
        AND existing.scope_type = 'pathway'
        AND existing.pathway_id = upa.pathway_id
        AND existing.starts_at = COALESCE(upa.granted_at, existing.starts_at)
        AND existing.expires_at IS NOT DISTINCT FROM upa.expires_at
  );

CREATE OR REPLACE FUNCTION public.has_premium_question_bank_access(p_bank_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND (
            public.is_support_or_admin()
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_access_grants grant_row
                  ON grant_row.user_id = auth.uid()
                 AND grant_row.starts_at <= now()
                 AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
                 AND (
                     grant_row.scope_type = 'global'
                     OR (
                         grant_row.scope_type = 'pathway'
                         AND grant_row.pathway_id = qb.pathway_id
                     )
                     OR (
                         grant_row.scope_type = 'bank'
                         AND grant_row.question_bank_id = qb.id
                     )
                 )
                WHERE qb.id = p_bank_id
            )
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                JOIN public.user_pathway_access upa
                  ON upa.pathway_id = qb.pathway_id
                WHERE qb.id = p_bank_id
                  AND upa.user_id = auth.uid()
                  AND upa.access_type = 'premium'
                  AND (upa.expires_at IS NULL OR upa.expires_at > now())
            )
        );
$$;

REVOKE ALL ON FUNCTION public.has_premium_question_bank_access(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_premium_question_bank_access(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_question_bank(p_bank_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND public.is_active_user()
        AND (
            public.has_premium_question_bank_access(p_bank_id)
            OR EXISTS (
                SELECT 1
                FROM public.question_banks qb
                WHERE qb.id = p_bank_id
                  AND qb.is_free_trial = TRUE
            )
        );
$$;

REVOKE ALL ON FUNCTION public.can_access_question_bank(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_question_bank(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_user_access(
    p_user_id UUID,
    p_scope_type TEXT,
    p_pathway_id BIGINT DEFAULT NULL,
    p_bank_id BIGINT DEFAULT NULL,
    p_starts_at TIMESTAMPTZ DEFAULT now(),
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.user_access_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    result public.user_access_grants;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF p_scope_type NOT IN ('global', 'pathway', 'bank') THEN
        RAISE EXCEPTION 'Invalid access scope';
    END IF;

    IF p_starts_at IS NULL THEN
        RAISE EXCEPTION 'starts_at is required';
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= p_starts_at THEN
        RAISE EXCEPTION 'expires_at must be after starts_at';
    END IF;

    IF p_scope_type = 'global' THEN
        IF p_pathway_id IS NOT NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Global access cannot specify a pathway or bank';
        END IF;
    ELSIF p_scope_type = 'pathway' THEN
        IF p_pathway_id IS NULL OR p_bank_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pathway access requires pathway_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
            RAISE EXCEPTION 'Pathway not found';
        END IF;
    ELSE
        IF p_bank_id IS NULL OR p_pathway_id IS NOT NULL THEN
            RAISE EXCEPTION 'Bank access requires bank_id only';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
            RAISE EXCEPTION 'Question bank not found';
        END IF;
    END IF;

    INSERT INTO public.user_access_grants (
        user_id,
        scope_type,
        pathway_id,
        question_bank_id,
        starts_at,
        expires_at,
        granted_by
    ) VALUES (
        p_user_id,
        p_scope_type,
        p_pathway_id,
        p_bank_id,
        p_starts_at,
        p_expires_at,
        auth.uid()
    )
    RETURNING * INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_user_access(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_user_access(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_user_access(p_grant_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    DELETE FROM public.user_access_grants
    WHERE id = p_grant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access grant not found';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_access(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_user_access(BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_exam_session(
    p_user_id UUID,
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INT,
    p_difficulties TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_topics JSONB DEFAULT '[]'::jsonb,
    p_question_selection TEXT DEFAULT 'new_only'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    new_session_id UUID;
    selected_question_ids BIGINT[];
    selected_count INT;
    effective_limit INT;
    trial_question_limit INT;
    has_premium BOOLEAN;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Session user does not match authenticated user';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Account is inactive';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 OR p_limit > 70 THEN
        RAISE EXCEPTION 'Question limit must be between 1 and 70';
    END IF;

    IF p_session_type NOT IN (
        'standard', 'tutor', 'timed', 'fixed_timed', 'mock_exam', 'review', 'quick_champion'
    ) THEN
        RAISE EXCEPTION 'Invalid session type';
    END IF;

    IF p_question_selection NOT IN (
        'new_only', 'incorrect_only', 'all', 'flagged_only', 'suspended_only'
    ) THEN
        RAISE EXCEPTION 'Invalid question selection';
    END IF;

    IF p_topics IS NULL OR jsonb_typeof(p_topics) <> 'array' THEN
        RAISE EXCEPTION 'Topic filters must be a JSON array';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.question_banks WHERE id = p_bank_id) THEN
        RAISE EXCEPTION 'Question bank not found';
    END IF;

    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    SELECT public.has_premium_question_bank_access(p_bank_id)
    INTO has_premium;

    SELECT qb.free_trial_question_limit
    INTO trial_question_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    effective_limit := LEAST(
        p_limit,
        CASE WHEN has_premium THEN 70 ELSE trial_question_limit END
    );

    SELECT ARRAY_AGG(chosen.question_id ORDER BY chosen.random_key)
    INTO selected_question_ids
    FROM (
        SELECT
            q.id AS question_id,
            random() AS random_key
        FROM public.question_bank_questions qbq
        JOIN public.questions q ON q.id = qbq.question_id
        JOIN public.get_user_question_states(p_bank_id) state
          ON state.question_id = q.id
        WHERE qbq.question_bank_id = p_bank_id
          AND (
              COALESCE(cardinality(p_difficulties), 0) = 0
              OR q.difficulty = ANY(p_difficulties)
          )
          AND (
              (
                  COALESCE(cardinality(p_categories), 0) = 0
                  AND jsonb_array_length(p_topics) = 0
              )
              OR q.category = ANY(p_categories)
              OR EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(p_topics) AS topic_filter
                  WHERE topic_filter->>'category' = q.category
                    AND topic_filter->>'topic' = q.topic
              )
          )
          AND CASE p_question_selection
              WHEN 'new_only' THEN state.is_new
              WHEN 'incorrect_only' THEN state.answer_state = 'incorrect'
              WHEN 'flagged_only' THEN state.is_flagged
              WHEN 'suspended_only' THEN state.is_suspended
              WHEN 'all' THEN TRUE
              ELSE FALSE
          END
        ORDER BY random_key
        LIMIT effective_limit
    ) AS chosen;

    selected_count := COALESCE(cardinality(selected_question_ids), 0);
    IF selected_count = 0 THEN
        RAISE EXCEPTION 'No questions match the selected filters';
    END IF;

    INSERT INTO public.test_sessions (
        user_id,
        question_bank_id,
        session_type,
        categories,
        difficulty_filter,
        question_selection,
        topic_filters,
        total_questions,
        is_completed
    ) VALUES (
        p_user_id,
        p_bank_id,
        p_session_type,
        COALESCE(p_categories, ARRAY[]::TEXT[]),
        COALESCE(p_difficulties, ARRAY[]::TEXT[]),
        p_question_selection,
        p_topics,
        selected_count,
        FALSE
    )
    RETURNING id INTO new_session_id;

    INSERT INTO public.test_session_questions (
        test_session_id,
        question_id,
        sort_order
    )
    SELECT
        new_session_id,
        selected.question_id,
        selected.ordinality::INT - 1
    FROM unnest(selected_question_ids) WITH ORDINALITY AS selected(question_id, ordinality);

    RETURN new_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INT, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_exam_session(
    UUID, BIGINT, TEXT, INT, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

COMMENT ON TABLE public.user_access_grants IS
'Authoritative scoped premium access. global covers all banks; pathway includes present/future banks in that pathway; bank covers one bank. expires_at NULL means lifetime.';
