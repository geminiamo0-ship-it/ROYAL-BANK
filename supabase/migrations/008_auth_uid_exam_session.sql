-- Add an auth-derived create_exam_session overload so application code no longer
-- needs a separate auth.getUser() round trip or a caller-supplied user id.
--
-- Keep the existing UUID-first function as the canonical authorization/business-rule
-- boundary. This thin SECURITY INVOKER wrapper derives the identity from the verified
-- Supabase JWT and delegates to the canonical function, which still re-checks that
-- the supplied user id matches auth.uid() before doing any privileged work.

CREATE OR REPLACE FUNCTION public.create_exam_session(
    p_bank_id BIGINT,
    p_session_type TEXT,
    p_limit INTEGER,
    p_difficulties TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_topics JSONB DEFAULT '[]'::JSONB,
    p_question_selection TEXT DEFAULT 'new_only'::TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    RETURN public.create_exam_session(
        v_user_id,
        p_bank_id,
        p_session_type,
        p_limit,
        p_difficulties,
        p_categories,
        p_topics,
        p_question_selection
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_session(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_exam_session(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_exam_session(
    BIGINT, TEXT, INTEGER, TEXT[], TEXT[], JSONB, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';
