CREATE OR REPLACE FUNCTION public.set_question_flag(
    p_question_id BIGINT,
    p_flagged BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_flagged THEN
        INSERT INTO public.user_question_flags (user_id, question_id)
        VALUES (auth.uid(), p_question_id)
        ON CONFLICT (user_id, question_id) DO NOTHING;
    ELSE
        DELETE FROM public.user_question_flags
        WHERE user_id = auth.uid()
          AND question_id = p_question_id;
    END IF;

    RETURN p_flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.set_question_flag(BIGINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_question_flag(BIGINT, BOOLEAN) TO authenticated;
