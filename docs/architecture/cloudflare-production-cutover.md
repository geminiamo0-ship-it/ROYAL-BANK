# Cloudflare Exam Production Cutover Manifest

Status: **prepared, not applied**

This document defines the production migration boundary for the Cloudflare exam architecture. It is intentionally conservative: Production keeps the existing business/auth/performance functions unless a separate reviewed change says otherwise.

## Production facts established by read-only reconciliation

Production Supabase project: `trnvsgenmzhyuayxxdoq`.

Verified present and compatible dependencies:

- `profiles`
- `question_banks`
- `question_bank_questions`
- `questions`
- `options`
- `test_sessions`
- `test_session_questions`
- `user_answers`
- `user_question_flags`
- `question_bank_dashboard_cache`
- `question_bank_performance_cache`
- `is_active_user()`
- `can_access_question_bank(bigint)`
- `mark_question_bank_dashboard_dirty(uuid,bigint)`
- `compute_question_bank_performance(bigint)`
- `get_question_bank_performance(bigint)`

All Production auth users had matching `profiles` rows at reconciliation time.

The following Edge object names were free at reconciliation time:

- `edge_exam_sync_inbox`
- `edge_exam_sessions`
- `edge_exam_session_questions`
- `edge_exam_answers`
- `edge_exam_flags`
- `edge_user_question_state`
- `edge_user_bank_daily`
- `ingest_edge_exam_sync_batch(jsonb)`

Run `scripts/preflight-edge-production.sql` again immediately before any production migration. The preflight is read-only.

## Functions to preserve from Production

Do **not** replace these functions as part of the Edge cutover:

- `public.can_access_question_bank(bigint)`
- `public.is_active_user()`
- `public.mark_question_bank_dashboard_dirty(uuid,bigint)`
- `public.get_question_bank_performance(bigint)`

Reason:

- `can_access_question_bank` and `is_active_user` are semantically aligned with DEV.
- Production `mark_question_bank_dashboard_dirty` dirties both dashboard and performance caches and must not be downgraded.
- Production `get_question_bank_performance` contains the cache/advisory-lock wrapper and should remain authoritative.
- `compute_question_bank_performance(bigint)` matched DEV during reconciliation and can consume the Edge-aware `get_user_question_states` bridge once installed.

## Additive Edge migration order

Apply only the reviewed Edge migrations below, in this order:

1. `20260916044500_v2_edge_exam_sync_inbox.sql`
2. `20260916050000_v2_edge_exam_history_materializer.sql`
3. `20260916063312_v2_completion_snapshot_questions.sql`
4. `20260916121608_v2_slim_history_bridge_core.sql`
5. `20260916121650_v2_slim_history_materializer.sql`
6. `20260916121717_v2_slim_history_read_bridge.sql`
7. `20260916121939_fix_v2_slim_history_state_ambiguity.sql`
8. `20260916122841_v2_edge_user_lifecycle_cleanup.sql`
9. `20260916123940_v2_compact_sync_inbox_retention.sql`

Do not run a blind `supabase db push` against Production because DEV and Production have different historical migration records.

## Cloudflare Production isolation

Production Cloudflare resources are explicit under `env.production` in `cloudflare/exam-gateway/wrangler.jsonc`.

Expected production resources:

- Worker: `royal-bank-exam-production`
- R2 bucket: `royal-bank-exam-production-content`
- Queue: `royal-bank-exam-production-sync`
- DLQ: `royal-bank-exam-production-sync-dlq`
- Durable Object binding: `USER_EXAMS`
- Supabase project ref: `trnvsgenmzhyuayxxdoq`

Required production secrets must be configured in the **production Wrangler environment** before deployment:

- `SUPABASE_SECRET_KEY`
- `SUPABASE_PUBLISHABLE_KEY`

Never reuse DEV secrets or DEV R2/Queue resources.

## Cutover gates

Production traffic must remain on the legacy `/api/exam` path until all gates below pass:

1. Read-only Production preflight returns `ready: true`.
2. The nine Edge migrations are reviewed and applied in order.
3. Post-migration checks confirm RLS, policies, triggers, FKs, RPC grants, and zero pending/error rows before traffic.
4. Production R2 content is built and validated against the active release contract.
5. Production Worker deploy passes `/health` with `APP_ENV=production` and the Production Supabase project ref.
6. Authenticated lifecycle smoke test passes: `prepare -> create -> window -> submit -> flag -> suspend -> resume -> complete`.
7. Queue-to-Supabase materialization completes and leaves no sync errors.
8. A controlled low-volume rollout is enabled with `ROYAL_EXAM_EDGE_ENABLED=true` only after the previous gates pass.

## Rollback

Immediate traffic rollback is server-side:

- set `ROYAL_EXAM_EDGE_ENABLED=false`
- redeploy/reload Vercel environment if required

The existing `/api/exam` implementation remains present during rollout.

Do not drop Edge tables or delete Durable Object state as an emergency rollback action. Leave Edge data intact for diagnosis/reconciliation while routing traffic back to the legacy path.

## Production remains untouched by this manifest

Adding this document, the preflight SQL, and the Wrangler production environment does **not** create Cloudflare resources, apply database migrations, set secrets, or route Production traffic.
