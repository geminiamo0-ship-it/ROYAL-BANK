CREATE POLICY "Active users insert own login history" ON "public"."login_history" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"()));

CREATE POLICY "Active users read own accessible answers" ON "public"."user_answers" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users read own accessible concepts" ON "public"."saved_concepts" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users read own accessible flags" ON "public"."user_question_flags" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users read own accessible notes" ON "public"."user_notes" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users read own accessible test_sessions" ON "public"."test_sessions" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question_bank"("question_bank_id")));

CREATE POLICY "Active users update own accessible answers" ON "public"."user_answers" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users update own accessible concepts" ON "public"."saved_concepts" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users update own accessible notes" ON "public"."user_notes" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users update own accessible test_sessions" ON "public"."test_sessions" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question_bank"("question_bank_id"))) WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question_bank"("question_bank_id")));

CREATE POLICY "Active users view own pathway access or staff view all" ON "public"."user_pathway_access" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_id") AND "public"."is_active_user"()) OR "public"."is_support_or_admin"()));

CREATE POLICY "Admins can read bank access audit" ON "public"."bank_access_audit" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "Admins can read profile access audit" ON "public"."profile_access_audit" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "Admins delete ip blocklist" ON "public"."ip_blocklist" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "Admins insert ip blocklist" ON "public"."ip_blocklist" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());

CREATE POLICY "Admins read ip blocklist" ON "public"."ip_blocklist" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

CREATE POLICY "Admins update ip blocklist" ON "public"."ip_blocklist" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

CREATE POLICY "Staff can read pathway access audit" ON "public"."pathway_access_audit" FOR SELECT TO "authenticated" USING ("public"."is_support_or_admin"());

CREATE POLICY "Users can view own scoped access" ON "public"."user_access_grants" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "user_id") OR "public"."is_support_or_admin"()));

CREATE POLICY "Users read accessible locked session questions" ON "public"."test_session_questions" FOR SELECT TO "authenticated" USING (("public"."is_active_user"() AND "public"."can_read_locked_session"("test_session_id")));

CREATE POLICY "Users view own login history or admins view all" ON "public"."login_history" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_id") AND "public"."is_active_user"()) OR "public"."is_admin"()));

CREATE POLICY "Users view own profile or active staff view all" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "id") OR "public"."is_support_or_admin"()));

CREATE POLICY "Users view own trial usage or staff audit all" ON "public"."free_trial_block_usage" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_id") AND "public"."is_active_user"()) OR "public"."is_support_or_admin"()));

ALTER TABLE "public"."bank_access_audit" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."free_trial_block_usage" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ip_blocklist" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."library_articles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."login_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."options" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."pathway_access_audit" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."pathways" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profile_access_audit" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."question_bank_questions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."question_banks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."questions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."saved_concepts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."test_session_questions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."test_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_access_grants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_answers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_notes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_pathway_access" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_question_flags" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA "public" TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "anon";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON TABLE "public"."question_banks" TO "anon";

GRANT ALL ON TABLE "public"."question_banks" TO "authenticated";

GRANT ALL ON TABLE "public"."question_banks" TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_configure_bank_access"("p_bank_id" bigint, "p_is_free_trial" boolean, "p_free_trial_block_limit" integer) TO "service_role";

GRANT ALL ON TABLE "public"."profiles" TO "anon";

GRANT ALL ON TABLE "public"."profiles" TO "authenticated";

GRANT ALL ON TABLE "public"."profiles" TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_update_user_access"("p_user_id" "uuid", "p_role" "text", "p_subscription_tier" "text", "p_is_active" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."audit_bank_access_change"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."audit_bank_access_change"() TO "anon";

GRANT ALL ON FUNCTION "public"."audit_bank_access_change"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."audit_bank_access_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."audit_pathway_access_change"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."audit_pathway_access_change"() TO "anon";

GRANT ALL ON FUNCTION "public"."audit_pathway_access_change"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."audit_pathway_access_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."audit_profile_access_change"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."audit_profile_access_change"() TO "anon";

GRANT ALL ON FUNCTION "public"."audit_profile_access_change"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."audit_profile_access_change"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) TO "anon";

GRANT ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) TO "authenticated";

GRANT ALL ON FUNCTION "public"."can_access_question"("p_question_id" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) TO "authenticated";

GRANT ALL ON FUNCTION "public"."can_access_question_bank"("p_bank_id" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") TO "anon";

GRANT ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."can_read_locked_session"("p_session_id" "uuid") TO "service_role";

GRANT ALL ON TABLE "public"."test_sessions" TO "anon";

GRANT ALL ON TABLE "public"."test_sessions" TO "authenticated";

GRANT ALL ON TABLE "public"."test_sessions" TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."complete_exam_session"("p_session_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."create_exam_session"("p_user_id" "uuid", "p_bank_id" bigint, "p_session_type" "text", "p_limit" integer, "p_difficulties" "text"[], "p_categories" "text"[], "p_topics" "jsonb", "p_question_selection" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_answer_finalization"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."enforce_answer_finalization"() TO "anon";

GRANT ALL ON FUNCTION "public"."enforce_answer_finalization"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."enforce_answer_finalization"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() TO "anon";

GRANT ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."enforce_free_trial_session_quota"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() TO "anon";

GRANT ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."enforce_test_session_update_integrity"() TO "service_role";

GRANT ALL ON FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) TO "anon";

GRANT ALL ON FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_category_topic_counts"("p_bank_id" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_category_topic_counts_json"("p_bank_id" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_exam_question_feedback"("p_session_id" "uuid", "p_question_id" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_exam_session_answers"("p_session_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_user_category_analytics"("p_user_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_user_question_states"("p_bank_id" bigint) TO "service_role";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_access_grants" TO "anon";

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_access_grants" TO "authenticated";

GRANT ALL ON TABLE "public"."user_access_grants" TO "service_role";

REVOKE ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) TO "anon";

GRANT ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) TO "authenticated";

GRANT ALL ON FUNCTION "public"."grant_user_access"("p_user_id" "uuid", "p_scope_type" "text", "p_pathway_id" bigint, "p_bank_id" bigint, "p_starts_at" timestamp with time zone, "p_expires_at" timestamp with time zone) TO "service_role";

GRANT ALL ON TABLE "public"."user_pathway_access" TO "anon";

GRANT ALL ON TABLE "public"."user_pathway_access" TO "authenticated";

GRANT ALL ON TABLE "public"."user_pathway_access" TO "service_role";

REVOKE ALL ON FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) TO "authenticated";

GRANT ALL ON FUNCTION "public"."grant_user_pathway_access"("p_user_id" "uuid", "p_pathway_id" bigint, "p_access_type" "text", "p_blocks_allowed" integer, "p_expires_at" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) TO "anon";

GRANT ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) TO "authenticated";

GRANT ALL ON FUNCTION "public"."has_premium_question_bank_access"("p_bank_id" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_active_user"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_active_user"() TO "anon";

GRANT ALL ON FUNCTION "public"."is_active_user"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_active_user"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";

GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_ip_blocked"("client_ip" "inet") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_ip_blocked"("client_ip" "inet") TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_ip_blocked"("client_ip" "inet") TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_support_or_admin"() FROM PUBLIC;
