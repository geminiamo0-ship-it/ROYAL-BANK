CREATE INDEX "idx_questions_category_topic_difficulty_id" ON "public"."questions" USING "btree" ("category", "topic", "difficulty", "id");

CREATE INDEX "idx_questions_difficulty" ON "public"."questions" USING "btree" ("difficulty");

CREATE INDEX "idx_questions_main_id" ON "public"."questions" USING "btree" ("main_id");

CREATE INDEX "idx_questions_notes_id" ON "public"."questions" USING "btree" ("notes_id");

CREATE INDEX "idx_questions_topic" ON "public"."questions" USING "btree" ("topic");

CREATE INDEX "idx_saved_concepts_user" ON "public"."saved_concepts" USING "btree" ("user_id");

CREATE INDEX "idx_test_session_questions_session_sort" ON "public"."test_session_questions" USING "btree" ("test_session_id", "sort_order");

CREATE INDEX "idx_test_sessions_user" ON "public"."test_sessions" USING "btree" ("user_id");

CREATE INDEX "idx_test_sessions_user_active" ON "public"."test_sessions" USING "btree" ("user_id", "is_completed", "id");

CREATE INDEX "idx_test_sessions_user_bank_active" ON "public"."test_sessions" USING "btree" ("user_id", "question_bank_id", "is_completed", "started_at" DESC);

CREATE INDEX "idx_test_sessions_user_started_desc" ON "public"."test_sessions" USING "btree" ("user_id", "started_at" DESC);

CREATE UNIQUE INDEX "idx_trial_usage_live_session" ON "public"."free_trial_block_usage" USING "btree" ("test_session_id") WHERE ("test_session_id" IS NOT NULL);

CREATE INDEX "idx_tsq_question_session" ON "public"."test_session_questions" USING "btree" ("question_id", "test_session_id");

CREATE INDEX "idx_user_access_grants_bank" ON "public"."user_access_grants" USING "btree" ("question_bank_id", "user_id") WHERE ("scope_type" = 'bank'::"text");

CREATE INDEX "idx_user_access_grants_pathway" ON "public"."user_access_grants" USING "btree" ("pathway_id", "user_id") WHERE ("scope_type" = 'pathway'::"text");

CREATE INDEX "idx_user_access_grants_user_active" ON "public"."user_access_grants" USING "btree" ("user_id", "scope_type", "starts_at", "expires_at");

CREATE INDEX "idx_user_answers_flagged" ON "public"."user_answers" USING "btree" ("user_id", "question_id") WHERE ("is_flagged" = true);

CREATE INDEX "idx_user_answers_incorrect" ON "public"."user_answers" USING "btree" ("user_id", "question_id") WHERE ("is_correct" = false);

CREATE INDEX "idx_user_answers_latest_state" ON "public"."user_answers" USING "btree" ("user_id", "question_id", "answered_at" DESC, "id" DESC);

CREATE INDEX "idx_user_answers_question" ON "public"."user_answers" USING "btree" ("question_id");

CREATE INDEX "idx_user_answers_session" ON "public"."user_answers" USING "btree" ("test_session_id");

CREATE INDEX "idx_user_answers_session_correct" ON "public"."user_answers" USING "btree" ("test_session_id", "is_correct");

CREATE INDEX "idx_user_answers_session_question_user" ON "public"."user_answers" USING "btree" ("test_session_id", "question_id", "user_id");

CREATE INDEX "idx_user_answers_user" ON "public"."user_answers" USING "btree" ("user_id");

CREATE INDEX "idx_user_answers_user_answered_question" ON "public"."user_answers" USING "btree" ("user_id", "answered_at" DESC, "question_id", "id" DESC);

CREATE INDEX "idx_user_answers_user_id_q_id" ON "public"."user_answers" USING "btree" ("user_id", "question_id");

CREATE INDEX "idx_user_answers_user_is_correct" ON "public"."user_answers" USING "btree" ("user_id", "is_correct");

CREATE INDEX "idx_user_answers_user_is_flagged" ON "public"."user_answers" USING "btree" ("user_id", "is_flagged");

CREATE INDEX "idx_user_answers_user_question" ON "public"."user_answers" USING "btree" ("user_id", "question_id");

CREATE INDEX "idx_user_notes_user" ON "public"."user_notes" USING "btree" ("user_id");

CREATE INDEX "idx_user_pathway_access_active_premium" ON "public"."user_pathway_access" USING "btree" ("user_id", "pathway_id", "expires_at") WHERE ("access_type" = 'premium'::"text");

CREATE INDEX "idx_user_pathway_access_user_pathway_expiry" ON "public"."user_pathway_access" USING "btree" ("user_id", "pathway_id", "access_type", "expires_at");

CREATE INDEX "idx_user_question_flags_question" ON "public"."user_question_flags" USING "btree" ("question_id");

CREATE INDEX "idx_user_question_flags_user_question" ON "public"."user_question_flags" USING "btree" ("user_id", "question_id");

CREATE UNIQUE INDEX "uq_question_bank_questions_question" ON "public"."question_bank_questions" USING "btree" ("question_id");

COMMENT ON INDEX "public"."uq_question_bank_questions_question" IS 'A question belongs to exactly one question bank. Cross-bank question sharing is forbidden.';

CREATE OR REPLACE TRIGGER "a_enforce_answer_finalization_trigger" BEFORE UPDATE ON "public"."user_answers" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_answer_finalization"();

CREATE OR REPLACE TRIGGER "audit_bank_access_change_trigger" AFTER UPDATE OF "is_free_trial", "free_trial_block_limit" ON "public"."question_banks" FOR EACH ROW EXECUTE FUNCTION "public"."audit_bank_access_change"();

CREATE OR REPLACE TRIGGER "audit_pathway_access_change_trigger" AFTER INSERT OR UPDATE ON "public"."user_pathway_access" FOR EACH ROW EXECUTE FUNCTION "public"."audit_pathway_access_change"();

CREATE OR REPLACE TRIGGER "audit_profile_access_change_trigger" AFTER UPDATE OF "role", "subscription_tier", "is_active" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."audit_profile_access_change"();

CREATE OR REPLACE TRIGGER "b_validate_user_answer_relationships_trigger" BEFORE INSERT OR UPDATE OF "test_session_id", "question_id", "selected_option_id", "is_correct" ON "public"."user_answers" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_answer_relationships"();

CREATE OR REPLACE TRIGGER "c_set_answer_server_timestamp" BEFORE INSERT OR UPDATE OF "selected_option_id" ON "public"."user_answers" FOR EACH ROW EXECUTE FUNCTION "public"."set_answer_server_timestamp"();

CREATE OR REPLACE TRIGGER "enforce_free_trial_session_quota_trigger" BEFORE INSERT ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_free_trial_session_quota"();

CREATE OR REPLACE TRIGGER "enforce_test_session_update_integrity_trigger" BEFORE UPDATE ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_test_session_update_integrity"();

CREATE OR REPLACE TRIGGER "record_free_trial_session_usage_trigger" AFTER INSERT ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."record_free_trial_session_usage"();

CREATE OR REPLACE TRIGGER "require_test_session_bank_trigger" BEFORE INSERT OR UPDATE OF "question_bank_id" ON "public"."test_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."require_test_session_bank"();

CREATE OR REPLACE TRIGGER "set_ip_block_actor_trigger" BEFORE INSERT OR UPDATE ON "public"."ip_blocklist" FOR EACH ROW EXECUTE FUNCTION "public"."set_ip_block_actor"();

CREATE OR REPLACE TRIGGER "set_login_history_time_trigger" BEFORE INSERT ON "public"."login_history" FOR EACH ROW EXECUTE FUNCTION "public"."set_login_history_time"();

CREATE OR REPLACE TRIGGER "validate_saved_concepts_question_access" BEFORE INSERT OR UPDATE OF "user_id", "question_id" ON "public"."saved_concepts" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_question_write_access"();

CREATE OR REPLACE TRIGGER "validate_user_notes_question_access" BEFORE INSERT OR UPDATE OF "user_id", "question_id" ON "public"."user_notes" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_question_write_access"();

ALTER TABLE ONLY "public"."bank_access_audit"
    ADD CONSTRAINT "bank_access_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."bank_access_audit"
    ADD CONSTRAINT "bank_access_audit_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."blocks"
    ADD CONSTRAINT "blocks_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_session_fk" FOREIGN KEY ("test_session_id") REFERENCES "public"."test_sessions"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."free_trial_block_usage"
    ADD CONSTRAINT "free_trial_block_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."ip_blocklist"
    ADD CONSTRAINT "ip_blocklist_blocked_by_fkey" FOREIGN KEY ("blocked_by") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."login_history"
    ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."options"
    ADD CONSTRAINT "options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."pathway_access_audit"
    ADD CONSTRAINT "pathway_access_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."profile_access_audit"
    ADD CONSTRAINT "profile_access_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."profile_access_audit"
    ADD CONSTRAINT "profile_access_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."question_bank_questions"
    ADD CONSTRAINT "question_bank_questions_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."question_bank_questions"
    ADD CONSTRAINT "question_bank_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."question_banks"
    ADD CONSTRAINT "question_banks_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."saved_concepts"
    ADD CONSTRAINT "saved_concepts_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."saved_concepts"
    ADD CONSTRAINT "saved_concepts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."test_session_questions"
    ADD CONSTRAINT "test_session_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."test_session_questions"
    ADD CONSTRAINT "test_session_questions_test_session_id_fkey" FOREIGN KEY ("test_session_id") REFERENCES "public"."test_sessions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."test_sessions"
    ADD CONSTRAINT "test_sessions_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."test_sessions"
    ADD CONSTRAINT "test_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_access_grants"
    ADD CONSTRAINT "user_access_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "public"."options"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_test_session_id_fkey" FOREIGN KEY ("test_session_id") REFERENCES "public"."test_sessions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_answers"
    ADD CONSTRAINT "user_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."profiles"("id");

ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."pathways"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_pathway_access"
    ADD CONSTRAINT "user_pathway_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_question_flags"
    ADD CONSTRAINT "user_question_flags_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."user_question_flags"
    ADD CONSTRAINT "user_question_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;

CREATE POLICY "Active users can read accessible bank mappings" ON "public"."question_bank_questions" FOR SELECT TO "authenticated" USING ("public"."can_access_question_bank"("question_bank_id"));

CREATE POLICY "Active users can read accessible questions" ON "public"."questions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."question_bank_questions" "qbq"
  WHERE (("qbq"."question_id" = "questions"."id") AND "public"."can_access_question_bank"("qbq"."question_bank_id")))));

CREATE POLICY "Active users can read blocks" ON "public"."blocks" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());

CREATE POLICY "Active users can read library articles" ON "public"."library_articles" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());

CREATE POLICY "Active users can read options for accessible questions" ON "public"."options" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."question_bank_questions" "qbq"
  WHERE (("qbq"."question_id" = "options"."question_id") AND "public"."can_access_question_bank"("qbq"."question_bank_id")))));

CREATE POLICY "Active users can read pathways" ON "public"."pathways" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());

CREATE POLICY "Active users can read question bank metadata" ON "public"."question_banks" FOR SELECT TO "authenticated" USING ("public"."is_active_user"());

CREATE POLICY "Active users delete own accessible concepts" ON "public"."saved_concepts" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users delete own accessible flags" ON "public"."user_question_flags" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users delete own accessible notes" ON "public"."user_notes" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users delete own incomplete test_sessions" ON "public"."test_sessions" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND ("is_completed" = false)));

CREATE POLICY "Active users insert own accessible answers" ON "public"."user_answers" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users insert own accessible concepts" ON "public"."saved_concepts" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users insert own accessible flags" ON "public"."user_question_flags" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));

CREATE POLICY "Active users insert own accessible notes" ON "public"."user_notes" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND "public"."is_active_user"() AND "public"."can_access_question"("question_id")));
