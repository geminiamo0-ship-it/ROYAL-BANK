BEGIN;

-- Production contains a few historical SECURITY DEFINER helpers that are not all
-- recreated by a clean migration rebuild. Harden every legacy signature when it
-- exists, while preserving the authenticated contract used by Royal RLS/RPCs.
DO $$
DECLARE
    v_signature TEXT;
    v_signatures TEXT[] := ARRAY[
        'public.audit_bank_access_change()',
        'public.audit_profile_access_change()',
        'public.can_access_question(bigint)',
        'public.can_access_question_bank(bigint)',
        'public.can_read_locked_session(uuid)',
        'public.enforce_answer_finalization()',
        'public.enforce_free_trial_session_quota()',
        'public.enforce_test_session_update_integrity()',
        'public.get_category_topic_counts(integer)',
        'public.get_category_topic_counts_json(bigint)',
        'public.get_user_category_analytics(uuid)',
        'public.handle_new_user()',
        'public.has_premium_question_bank_access(bigint)',
        'public.is_active_user()',
        'public.is_admin()',
        'public.is_support_or_admin()',
        'public.record_free_trial_session_usage()',
        'public.rls_auto_enable()',
        'public.set_ip_block_actor()',
        'public.validate_user_answer_relationships()',
        'public.validate_user_question_write_access()'
    ];
BEGIN
    FOREACH v_signature IN ARRAY v_signatures LOOP
        IF to_regprocedure(v_signature) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_signature);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_signature);
        END IF;
    END LOOP;
END;
$$;

COMMIT;
