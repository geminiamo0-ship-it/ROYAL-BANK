SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

GRANT ALL ON FUNCTION "public"."is_support_or_admin"() TO "anon";

GRANT ALL ON FUNCTION "public"."is_support_or_admin"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_support_or_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_free_trial_session_usage"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."record_free_trial_session_usage"() TO "anon";

GRANT ALL ON FUNCTION "public"."record_free_trial_session_usage"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."record_free_trial_session_usage"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."refresh_question_bank_counts"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."refresh_question_bank_counts"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."refresh_question_bank_counts"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."require_test_session_bank"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."require_test_session_bank"() TO "anon";

GRANT ALL ON FUNCTION "public"."require_test_session_bank"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."require_test_session_bank"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) TO "anon";

GRANT ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) TO "authenticated";

GRANT ALL ON FUNCTION "public"."revoke_user_access"("p_grant_id" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_answer_server_timestamp"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."set_answer_server_timestamp"() TO "anon";

GRANT ALL ON FUNCTION "public"."set_answer_server_timestamp"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."set_answer_server_timestamp"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_ip_block_actor"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."set_ip_block_actor"() TO "anon";

GRANT ALL ON FUNCTION "public"."set_ip_block_actor"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."set_ip_block_actor"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_login_history_time"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."set_login_history_time"() TO "anon";

GRANT ALL ON FUNCTION "public"."set_login_history_time"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."set_login_history_time"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) TO "authenticated";

GRANT ALL ON FUNCTION "public"."set_question_flag"("p_question_id" bigint, "p_flagged" boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."submit_exam_answer"("p_session_id" "uuid", "p_question_id" bigint, "p_selected_option_id" bigint, "p_time_spent_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."update_my_profile"("p_full_name" "text", "p_avatar_url" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_user_answer_relationships"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."validate_user_answer_relationships"() TO "anon";

GRANT ALL ON FUNCTION "public"."validate_user_answer_relationships"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."validate_user_answer_relationships"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."validate_user_question_write_access"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."validate_user_question_write_access"() TO "anon";

GRANT ALL ON FUNCTION "public"."validate_user_question_write_access"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."validate_user_question_write_access"() TO "service_role";

GRANT ALL ON TABLE "public"."bank_access_audit" TO "anon";

GRANT ALL ON TABLE "public"."bank_access_audit" TO "authenticated";

GRANT ALL ON TABLE "public"."bank_access_audit" TO "service_role";

GRANT ALL ON SEQUENCE "public"."bank_access_audit_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."bank_access_audit_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."bank_access_audit_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."blocks" TO "anon";

GRANT ALL ON TABLE "public"."blocks" TO "authenticated";

GRANT ALL ON TABLE "public"."blocks" TO "service_role";

GRANT ALL ON SEQUENCE "public"."blocks_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."blocks_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."blocks_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."free_trial_block_usage" TO "anon";

GRANT ALL ON TABLE "public"."free_trial_block_usage" TO "authenticated";

GRANT ALL ON TABLE "public"."free_trial_block_usage" TO "service_role";

GRANT ALL ON SEQUENCE "public"."free_trial_block_usage_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."free_trial_block_usage_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."free_trial_block_usage_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."ip_blocklist" TO "anon";

GRANT ALL ON TABLE "public"."ip_blocklist" TO "authenticated";

GRANT ALL ON TABLE "public"."ip_blocklist" TO "service_role";

GRANT ALL ON SEQUENCE "public"."ip_blocklist_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."ip_blocklist_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."ip_blocklist_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."library_articles" TO "anon";

GRANT ALL ON TABLE "public"."library_articles" TO "authenticated";

GRANT ALL ON TABLE "public"."library_articles" TO "service_role";

GRANT ALL ON TABLE "public"."login_history" TO "anon";

GRANT ALL ON TABLE "public"."login_history" TO "authenticated";

GRANT ALL ON TABLE "public"."login_history" TO "service_role";

GRANT ALL ON SEQUENCE "public"."login_history_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."login_history_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."login_history_id_seq" TO "service_role";

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."options" TO "anon";

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."options" TO "authenticated";

GRANT ALL ON TABLE "public"."options" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."options" TO "authenticated";

GRANT SELECT("question_id") ON TABLE "public"."options" TO "authenticated";

GRANT SELECT("text_html") ON TABLE "public"."options" TO "authenticated";

GRANT SELECT("option_order") ON TABLE "public"."options" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."options_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."options_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."options_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."pathway_access_audit" TO "anon";

GRANT ALL ON TABLE "public"."pathway_access_audit" TO "authenticated";

GRANT ALL ON TABLE "public"."pathway_access_audit" TO "service_role";

GRANT ALL ON SEQUENCE "public"."pathway_access_audit_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."pathway_access_audit_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."pathway_access_audit_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."pathways" TO "anon";

GRANT ALL ON TABLE "public"."pathways" TO "authenticated";

GRANT ALL ON TABLE "public"."pathways" TO "service_role";

GRANT ALL ON SEQUENCE "public"."pathways_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."pathways_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."pathways_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."profile_access_audit" TO "anon";

GRANT ALL ON TABLE "public"."profile_access_audit" TO "authenticated";

GRANT ALL ON TABLE "public"."profile_access_audit" TO "service_role";

GRANT ALL ON SEQUENCE "public"."profile_access_audit_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."profile_access_audit_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."profile_access_audit_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."question_bank_questions" TO "anon";

GRANT ALL ON TABLE "public"."question_bank_questions" TO "authenticated";

GRANT ALL ON TABLE "public"."question_bank_questions" TO "service_role";

GRANT ALL ON SEQUENCE "public"."question_bank_questions_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."question_bank_questions_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."question_bank_questions_id_seq" TO "service_role";

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."questions" TO "anon";

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."questions" TO "authenticated";

GRANT ALL ON TABLE "public"."questions" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("main_id") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("text_html") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("category") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("topic") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("concept_id") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("notes_id") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("difficulty") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("source") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("pm_question_id") ON TABLE "public"."questions" TO "authenticated";

GRANT SELECT("created_at") ON TABLE "public"."questions" TO "authenticated";

GRANT ALL ON TABLE "public"."question_bank_topic_counts" TO "anon";

GRANT ALL ON TABLE "public"."question_bank_topic_counts" TO "authenticated";

GRANT ALL ON TABLE "public"."question_bank_topic_counts" TO "service_role";

GRANT ALL ON SEQUENCE "public"."question_banks_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."question_banks_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."question_banks_id_seq" TO "service_role";

GRANT ALL ON SEQUENCE "public"."questions_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."questions_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."questions_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."saved_concepts" TO "anon";

GRANT ALL ON TABLE "public"."saved_concepts" TO "authenticated";

GRANT ALL ON TABLE "public"."saved_concepts" TO "service_role";

GRANT ALL ON SEQUENCE "public"."saved_concepts_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."saved_concepts_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."saved_concepts_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."test_session_questions" TO "anon";

GRANT ALL ON TABLE "public"."test_session_questions" TO "authenticated";

GRANT ALL ON TABLE "public"."test_session_questions" TO "service_role";

GRANT ALL ON SEQUENCE "public"."user_access_grants_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."user_access_grants_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."user_access_grants_id_seq" TO "service_role";

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."user_answers" TO "anon";

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."user_answers" TO "authenticated";

GRANT ALL ON TABLE "public"."user_answers" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("test_session_id") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("user_id") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("question_id") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("selected_option_id") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("is_flagged") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("time_spent_seconds") ON TABLE "public"."user_answers" TO "authenticated";

GRANT SELECT("answered_at") ON TABLE "public"."user_answers" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."user_answers_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."user_answers_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."user_answers_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."user_latest_answer_state" TO "service_role";

GRANT ALL ON TABLE "public"."user_notes" TO "anon";

GRANT ALL ON TABLE "public"."user_notes" TO "authenticated";

GRANT ALL ON TABLE "public"."user_notes" TO "service_role";

GRANT ALL ON SEQUENCE "public"."user_notes_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."user_notes_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."user_notes_id_seq" TO "service_role";

GRANT ALL ON SEQUENCE "public"."user_pathway_access_id_seq" TO "anon";

GRANT ALL ON SEQUENCE "public"."user_pathway_access_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."user_pathway_access_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."user_question_flags" TO "anon";

GRANT ALL ON TABLE "public"."user_question_flags" TO "authenticated";

GRANT ALL ON TABLE "public"."user_question_flags" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- Cross-schema triggers owned by ROYAL-BANK public functions.
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Access expiry removes the right to use bank content, but it must not hide the
-- user's own historical records. Reads of owned history are therefore separated
-- from current bank authorization. Writes/resume/session creation remain governed
-- by the existing current-access policies and RPC checks.

DROP POLICY IF EXISTS "Active users read own accessible test_sessions" ON public.test_sessions;

DROP POLICY IF EXISTS "Active users read own test_sessions" ON public.test_sessions;

CREATE POLICY "Active users read own session history"
    ON public.test_sessions
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible answers" ON public.user_answers;

DROP POLICY IF EXISTS "Active users read own answers" ON public.user_answers;

CREATE POLICY "Active users read own answer history"
    ON public.user_answers
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible notes" ON public.user_notes;

CREATE POLICY "Active users read own note history"
    ON public.user_notes
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible concepts" ON public.saved_concepts;

CREATE POLICY "Active users read own concept history"
    ON public.saved_concepts
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

DROP POLICY IF EXISTS "Active users read own accessible flags" ON public.user_question_flags;

CREATE POLICY "Active users read own flag history"
    ON public.user_question_flags
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        AND public.is_active_user()
    );

COMMENT ON TABLE public.test_sessions IS
'Completed sessions are immutable owned history. Active owners may read historical sessions after bank access expires. Incomplete sessions may be deleted after expiry, but resuming/updating them still requires current bank access.';

COMMENT ON TABLE public.user_answers IS
'Answer rows remain owned history after bank access expires. Reading owned history does not restore current question-bank access or permit answer mutation.';
