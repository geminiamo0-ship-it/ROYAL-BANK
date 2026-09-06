-- One effective access record per user/pathway keeps authorization deterministic.

DELETE FROM public.user_pathway_access a
USING public.user_pathway_access b
WHERE a.user_id = b.user_id
  AND a.pathway_id = b.pathway_id
  AND a.id < b.id;

ALTER TABLE public.user_pathway_access
    ADD CONSTRAINT user_pathway_access_user_pathway_key UNIQUE (user_id, pathway_id);

CREATE OR REPLACE FUNCTION public.grant_user_pathway_access(
    p_user_id UUID,
    p_pathway_id BIGINT,
    p_access_type TEXT,
    p_blocks_allowed INT DEFAULT 1,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.user_pathway_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    access_row public.user_pathway_access;
BEGIN
    IF NOT public.is_support_or_admin() THEN
        RAISE EXCEPTION 'Support or admin access required';
    END IF;

    IF p_access_type NOT IN ('free_trial', 'premium') THEN
        RAISE EXCEPTION 'Invalid access type';
    END IF;

    IF p_blocks_allowed < 0 THEN
        RAISE EXCEPTION 'blocks_allowed cannot be negative';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.pathways WHERE id = p_pathway_id) THEN
        RAISE EXCEPTION 'Pathway not found';
    END IF;

    INSERT INTO public.user_pathway_access (
        user_id,
        pathway_id,
        access_type,
        blocks_allowed,
        granted_by,
        granted_at,
        expires_at
    ) VALUES (
        p_user_id,
        p_pathway_id,
        p_access_type,
        p_blocks_allowed,
        auth.uid(),
        timezone('utc'::text, now()),
        p_expires_at
    )
    ON CONFLICT (user_id, pathway_id)
    DO UPDATE SET
        access_type = EXCLUDED.access_type,
        blocks_allowed = EXCLUDED.blocks_allowed,
        granted_by = EXCLUDED.granted_by,
        granted_at = EXCLUDED.granted_at,
        expires_at = EXCLUDED.expires_at
    RETURNING * INTO access_row;

    RETURN access_row;
END;
$$;
