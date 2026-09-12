BEGIN;

ALTER FUNCTION public.create_catalog_upgrade_request(bigint, text, uuid)
RENAME TO create_catalog_upgrade_request_hardened_impl;

REVOKE EXECUTE ON FUNCTION public.create_catalog_upgrade_request_hardened_impl(bigint, text, uuid)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_catalog_upgrade_request(
    p_plan_id BIGINT,
    p_promo_code TEXT DEFAULT NULL,
    p_replace_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
SET row_security = off
AS $$
DECLARE
    v_message TEXT;
    v_product_type TEXT;
    v_pathway_id BIGINT;
    v_bank_id BIGINT;
    v_access JSONB;
BEGIN
    BEGIN
        RETURN public.create_catalog_upgrade_request_hardened_impl(
            p_plan_id,
            p_promo_code,
            p_replace_request_id
        );
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;

        IF v_message = 'ACTIVE_SUBSCRIPTION_EXISTS' THEN
            SELECT product.product_type, product.pathway_id, product.question_bank_id
            INTO v_product_type, v_pathway_id, v_bank_id
            FROM public.catalog_plans plan_row
            JOIN public.catalog_products product ON product.id = plan_row.product_id
            WHERE plan_row.id = p_plan_id;

            IF FOUND THEN
                v_access := public.resolve_my_access(
                    v_product_type,
                    CASE WHEN v_product_type = 'pathway' THEN v_pathway_id ELSE NULL END,
                    CASE WHEN v_product_type = 'bank' THEN v_bank_id ELSE NULL END
                );

                IF COALESCE((v_access->>'has_access')::BOOLEAN, FALSE)
                   AND v_access->>'coverage_kind' = 'broader' THEN
                    RAISE EXCEPTION 'ACCESS_ALREADY_COVERED_BY_BROADER_GRANT';
                END IF;
            END IF;
        END IF;

        RAISE;
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_catalog_upgrade_request(bigint, text, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_catalog_upgrade_request(bigint, text, uuid)
TO authenticated, service_role;

COMMIT;
