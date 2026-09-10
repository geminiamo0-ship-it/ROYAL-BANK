BEGIN;

-- Close the remaining legacy anonymous SECURITY DEFINER surface while preserving
-- the authenticated contract used by Royal RLS/RPC helpers. Trigger execution is
-- unaffected by function EXECUTE ACLs, but authenticated is explicitly retained
-- to avoid changing any existing signed-in behavior.

REVOKE ALL ON FUNCTION public.audit_bank_access_change() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.audit_profile_access_change() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_question(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_question_bank(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_locked_session(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_answer_finalization() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_free_trial_session_quota() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_test_session_update_integrity() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_category_topic_counts(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_category_analytics(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_premium_question_bank_access(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_support_or_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_free_trial_session_usage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_ip_block_actor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_user_answer_relationships() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.validate_user_question_write_access() FROM PUBLIC, anon;

-- Production still contains a historical bigint overload that is absent from a
-- clean migration rebuild. Harden it when present without making local CI drift.
DO $$
BEGIN
    IF to_regprocedure('public.get_category_topic_counts_json(bigint)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.get_category_topic_counts_json(bigint) FROM PUBLIC, anon';
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_category_topic_counts_json(bigint) TO authenticated';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_bank_access_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_profile_access_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_question(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_question_bank(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_locked_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_answer_finalization() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_free_trial_session_quota() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_test_session_update_integrity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_topic_counts(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_category_analytics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_premium_question_bank_access(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_support_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_free_trial_session_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ip_block_actor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_user_answer_relationships() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_user_question_write_access() TO authenticated;

COMMIT;
