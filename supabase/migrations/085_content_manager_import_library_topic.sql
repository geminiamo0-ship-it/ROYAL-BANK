-- Keep Content Manager library imports aligned with the topic metadata added in
-- 084_library_topic_metadata.sql. This preserves the existing service-role-only
-- import surface while writing topic alongside category/name/content.

CREATE OR REPLACE FUNCTION public.content_manager_import_articles(
    p_bank_id BIGINT,
    p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
    v_row JSONB;
    v_article_count INTEGER := 0;
BEGIN
    IF p_bank_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.question_banks WHERE id = p_bank_id
    ) THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_BANK_NOT_FOUND';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_ARTICLE_PAYLOAD';
    END IF;

    IF jsonb_array_length(p_rows) > 500 THEN
        RAISE EXCEPTION 'CONTENT_MANAGER_ARTICLE_BATCH_TOO_LARGE';
    END IF;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        IF COALESCE(btrim(v_row->>'id'), '') = ''
           OR COALESCE(btrim(v_row->>'name'), '') = ''
           OR COALESCE(btrim(v_row->>'content_html'), '') = '' THEN
            RAISE EXCEPTION 'CONTENT_MANAGER_INVALID_ARTICLE';
        END IF;

        INSERT INTO public.library_articles (
            id,
            name,
            category,
            topic,
            content_html,
            source
        )
        VALUES (
            v_row->>'id',
            v_row->>'name',
            NULLIF(v_row->>'category', ''),
            NULLIF(v_row->>'topic', ''),
            v_row->>'content_html',
            COALESCE(NULLIF(v_row->>'source', ''), 'Pastest')
        )
        ON CONFLICT (id) DO UPDATE
        SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            topic = EXCLUDED.topic,
            content_html = EXCLUDED.content_html,
            source = EXCLUDED.source;

        INSERT INTO public.question_bank_library_articles (
            question_bank_id,
            article_id,
            display_order
        )
        VALUES (
            p_bank_id,
            v_row->>'id',
            COALESCE(NULLIF(v_row->>'display_order', '')::INTEGER, 0)
        )
        ON CONFLICT (question_bank_id, article_id) DO UPDATE
        SET display_order = EXCLUDED.display_order;

        v_article_count := v_article_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'bank_id', p_bank_id,
        'articles_processed', v_article_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.content_manager_import_articles(BIGINT, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.content_manager_import_articles(BIGINT, JSONB)
    TO service_role;
