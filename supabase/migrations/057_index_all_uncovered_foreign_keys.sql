-- Cover every currently unindexed foreign key in the application schemas.
-- Besides join performance, these indexes prevent parent UPDATE/DELETE checks
-- from degrading into child-table scans as Royal Bank grows.

CREATE INDEX IF NOT EXISTS idx_fk_exam_security_events_question_bank
    ON private.exam_security_events(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_fk_exam_security_events_session
    ON private.exam_security_events(session_id);
CREATE INDEX IF NOT EXISTS idx_fk_exam_timed_finalization_context_session
    ON private.exam_timed_finalization_context(session_id);
CREATE INDEX IF NOT EXISTS idx_fk_exam_timed_finalization_context_user
    ON private.exam_timed_finalization_context(user_id);
CREATE INDEX IF NOT EXISTS idx_fk_question_disclosures_first_bank
    ON private.question_disclosures(first_bank_id);
CREATE INDEX IF NOT EXISTS idx_fk_question_disclosures_first_session
    ON private.question_disclosures(first_session_id);
CREATE INDEX IF NOT EXISTS idx_fk_question_disclosures_question
    ON private.question_disclosures(question_id);

CREATE INDEX IF NOT EXISTS idx_fk_bank_access_audit_changed_by
    ON public.bank_access_audit(changed_by);
CREATE INDEX IF NOT EXISTS idx_fk_blocks_question_bank
    ON public.blocks(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_fk_commission_settlements_created_by
    ON public.commission_settlements(created_by);
CREATE INDEX IF NOT EXISTS idx_fk_commissions_promo_code
    ON public.commissions(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_free_trial_block_usage_question_bank
    ON public.free_trial_block_usage(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_fk_ip_blocklist_blocked_by
    ON public.ip_blocklist(blocked_by);

CREATE INDEX IF NOT EXISTS idx_fk_orders_created_by
    ON public.orders(created_by);
CREATE INDEX IF NOT EXISTS idx_fk_orders_pathway
    ON public.orders(pathway_id);
CREATE INDEX IF NOT EXISTS idx_fk_orders_promo_code
    ON public.orders(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_orders_question_bank
    ON public.orders(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_fk_orders_refunded_by
    ON public.orders(refunded_by);

CREATE INDEX IF NOT EXISTS idx_fk_payments_refunded_by
    ON public.payments(refunded_by);
CREATE INDEX IF NOT EXISTS idx_fk_payments_verified_by
    ON public.payments(verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_profile_access_audit_changed_by
    ON public.profile_access_audit(changed_by);
CREATE INDEX IF NOT EXISTS idx_fk_promo_codes_created_by
    ON public.promo_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_fk_saved_concepts_question
    ON public.saved_concepts(question_id);
CREATE INDEX IF NOT EXISTS idx_fk_test_sessions_question_bank
    ON public.test_sessions(question_bank_id);

CREATE INDEX IF NOT EXISTS idx_fk_upgrade_requests_cancelled_by
    ON public.upgrade_requests(cancelled_by);
CREATE INDEX IF NOT EXISTS idx_fk_upgrade_requests_pathway
    ON public.upgrade_requests(pathway_id);
CREATE INDEX IF NOT EXISTS idx_fk_upgrade_requests_question_bank
    ON public.upgrade_requests(question_bank_id);

CREATE INDEX IF NOT EXISTS idx_fk_user_access_grants_granted_by
    ON public.user_access_grants(granted_by);
CREATE INDEX IF NOT EXISTS idx_fk_user_access_grants_revoked_by
    ON public.user_access_grants(revoked_by);
CREATE INDEX IF NOT EXISTS idx_fk_user_answers_selected_option
    ON public.user_answers(selected_option_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_notes_question
    ON public.user_notes(question_id);
