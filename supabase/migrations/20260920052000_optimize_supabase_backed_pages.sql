-- Split large static page payloads from user-specific state.
-- Static Library/Study Plan catalogs are published to private R2.

CREATE OR REPLACE FUNCTION public.get_library_catalog_access_state(p_bank_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_temp'
SET row_security TO 'off'
AS $$
DECLARE
    v_trial_enabled BOOLEAN;
    v_trial_limit INTEGER;
    v_has_premium BOOLEAN;
    v_used INTEGER := 0;
    v_disclosed JSONB := '[]'::jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
        RAISE EXCEPTION 'ACTIVE_AUTHENTICATION_REQUIRED';
    END IF;

    SELECT qb.is_free_trial, qb.free_trial_article_limit
      INTO v_trial_enabled, v_trial_limit
    FROM public.question_banks qb
    WHERE qb.id = p_bank_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'QUESTION_BANK_NOT_FOUND';
    END IF;

    v_has_premium := public.has_premium_question_bank_access(p_bank_id);
    IF NOT v_has_premium AND NOT v_trial_enabled THEN
        RAISE EXCEPTION 'LIBRARY_ACCESS_DENIED';
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(jsonb_agg(disclosure.article_id ORDER BY disclosure.article_id), '[]'::jsonb)
      INTO v_used, v_disclosed
    FROM private.library_article_disclosures disclosure
    WHERE disclosure.user_id = auth.uid()
      AND disclosure.question_bank_id = p_bank_id;

    RETURN jsonb_build_object(
        'premium_access', v_has_premium,
        'trial_limit', CASE WHEN v_has_premium THEN NULL ELSE v_trial_limit END,
        'trial_remaining', CASE
            WHEN v_has_premium THEN NULL
            ELSE GREATEST(v_trial_limit - v_used, 0)
        END,
        'disclosed_article_ids', v_disclosed
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_library_catalog_access_state(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_library_catalog_access_state(BIGINT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_study_plan_dashboard_light(p_bank_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF NOT public.can_access_question_bank(p_bank_id) THEN
        RAISE EXCEPTION 'Question bank access denied';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.study_plans sp
        WHERE sp.user_id = auth.uid()
          AND sp.question_bank_id = p_bank_id
          AND sp.status = 'active'
    ) THEN
        RETURN jsonb_build_object('bank_id', p_bank_id, 'plan', NULL);
    END IF;

    RETURN public.get_study_plan_dashboard(p_bank_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_plan_dashboard_light(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_plan_dashboard_light(BIGINT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_library_catalog_access_state(BIGINT) IS
  'Compact user-specific library entitlement/disclosure state. Static article list lives in private R2.';
COMMENT ON FUNCTION public.get_study_plan_dashboard_light(BIGINT) IS
  'Fast no-plan Study Plan read boundary; delegates to full dashboard only when an active plan exists.';
