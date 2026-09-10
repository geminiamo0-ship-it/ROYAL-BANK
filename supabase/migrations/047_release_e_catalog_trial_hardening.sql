BEGIN;

-- Release E follow-up: make disabling a bank trial satisfy the canonical
-- question_banks trial shape and validate limits before the table constraints
-- are reached. Also index the four catalog audit foreign keys introduced in
-- Release E so the release does not add new unindexed-FK advisor debt.

CREATE OR REPLACE FUNCTION public.admin_update_catalog_bank_trial(
    p_bank_id BIGINT,
    p_is_free_trial BOOLEAN,
    p_block_limit INTEGER,
    p_question_limit INTEGER,
    p_article_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_bank public.question_banks%ROWTYPE;
    v_before JSONB;
    v_enabled BOOLEAN := COALESCE(p_is_free_trial, FALSE);
BEGIN
    IF NOT private.business_is_admin() THEN
        RAISE EXCEPTION 'ADMIN_ACCESS_REQUIRED';
    END IF;

    IF p_question_limit IS NULL
       OR p_question_limit NOT BETWEEN 1 AND 70
       OR p_article_limit IS NULL
       OR p_article_limit < 0
       OR (v_enabled AND (p_block_limit IS NULL OR p_block_limit < 0)) THEN
        RAISE EXCEPTION 'INVALID_TRIAL_CONFIGURATION';
    END IF;

    SELECT * INTO v_bank
    FROM public.question_banks
    WHERE id = p_bank_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'CATALOG_PRODUCT_NOT_FOUND';
    END IF;

    v_before := jsonb_build_object(
        'is_free_trial', v_bank.is_free_trial,
        'free_trial_block_limit', v_bank.free_trial_block_limit,
        'free_trial_question_limit', v_bank.free_trial_question_limit,
        'free_trial_article_limit', v_bank.free_trial_article_limit
    );

    UPDATE public.question_banks
    SET
        is_free_trial = v_enabled,
        free_trial_block_limit = CASE WHEN v_enabled THEN p_block_limit ELSE NULL END,
        free_trial_question_limit = p_question_limit,
        free_trial_article_limit = p_article_limit
    WHERE id = p_bank_id
    RETURNING * INTO v_bank;

    UPDATE public.pathways pathway
    SET is_free_trial_available = EXISTS (
        SELECT 1
        FROM public.question_banks bank
        WHERE bank.pathway_id = pathway.id
          AND bank.is_free_trial
    )
    WHERE pathway.id = v_bank.pathway_id;

    PERFORM private.business_audit(
        'catalog_bank_trial_saved',
        'question_bank',
        v_bank.id::TEXT,
        jsonb_build_object(
            'before_data', v_before,
            'after_data', jsonb_build_object(
                'is_free_trial', v_bank.is_free_trial,
                'free_trial_block_limit', v_bank.free_trial_block_limit,
                'free_trial_question_limit', v_bank.free_trial_question_limit,
                'free_trial_article_limit', v_bank.free_trial_article_limit
            )
        )
    );

    RETURN jsonb_build_object('bank_id', v_bank.id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_catalog_bank_trial(BIGINT, BOOLEAN, INTEGER, INTEGER, INTEGER)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_catalog_bank_trial(BIGINT, BOOLEAN, INTEGER, INTEGER, INTEGER)
TO authenticated;

CREATE INDEX IF NOT EXISTS catalog_products_created_by_idx
    ON public.catalog_products (created_by)
    WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_products_updated_by_idx
    ON public.catalog_products (updated_by)
    WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_plans_created_by_idx
    ON public.catalog_plans (created_by)
    WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_plans_updated_by_idx
    ON public.catalog_plans (updated_by)
    WHERE updated_by IS NOT NULL;

COMMIT;
