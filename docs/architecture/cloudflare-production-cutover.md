# Cloudflare Exam Production Cutover Manifest

Status: **Production Edge database schema applied; Cloudflare Production deploy and traffic cutover still pending**

This document defines the production migration boundary for the Cloudflare exam architecture. Production keeps the existing business/auth/performance functions unless a separate reviewed change says otherwise.

## Production facts established by reconciliation

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

The final preflight immediately before migration returned `ready: true`. At that point all 10 Production auth users had matching `profiles` rows, the required ACL checks passed, and all Edge object names were free.

## Functions preserved from Production

The Edge database rollout did **not** replace these Production functions:

- `public.can_access_question_bank(bigint)`
- `public.is_active_user()`
- `public.mark_question_bank_dashboard_dirty(uuid,bigint)`
- `public.get_question_bank_performance(bigint)`

Reason:

- `can_access_question_bank` and `is_active_user` were semantically aligned with DEV.
- Production `mark_question_bank_dashboard_dirty` dirties both dashboard and performance caches and must not be downgraded.
- Production `get_question_bank_performance` contains the cache/advisory-lock wrapper and remains authoritative.
- `compute_question_bank_performance(bigint)` matched DEV and can consume the Edge-aware `get_user_question_states` bridge.

## Production Edge migrations applied

The following reviewed Edge migrations were applied to Production in order:

1. `v2_edge_exam_sync_inbox`
2. `v2_edge_exam_history_materializer`
3. `v2_completion_snapshot_questions`
4. `v2_slim_history_bridge_core`
5. `v2_slim_history_materializer`
6. `v2_slim_history_read_bridge`
7. `fix_v2_slim_history_state_ambiguity`
8. `v2_edge_user_lifecycle_cleanup`
9. `v2_compact_sync_inbox_retention`

Do not run a blind `supabase db push` against Production because DEV and Production have different historical migration records.

### Post-migration verification

Verified after the migration chain:

- all 7 Edge tables exist
- RLS is enabled on all 7 Edge tables
- `ingest_edge_exam_sync_batch(jsonb)` exists
- `materialize_edge_exam_sync_inbox_row()` exists
- `get_user_question_states(bigint)` exists
- `get_my_bank_sessions(bigint,integer)` exists
- `get_my_bank_activity_rollup(bigint)` exists
- `get_question_bank_performance_v2(bigint)` exists
- 6 profile foreign keys are installed with the Edge lifecycle cleanup
- ingest RPC execute access is denied to `anon` and `authenticated`, and allowed to `service_role`
- Edge sync inbox was empty immediately after rollout: 0 total, 0 pending, 0 errors

## Cloudflare Production isolation

Production Cloudflare resources are explicit under `env.production` in `cloudflare/exam-gateway/wrangler.jsonc`.

Expected production resources:

- Worker: `royal-bank-exam-production`
- R2 bucket: `royal-bank-exam-production-content`
- Queue: `royal-bank-exam-production-sync`
- DLQ: `royal-bank-exam-production-sync-dlq`
- Durable Object binding: `USER_EXAMS`
- Supabase project ref: `trnvsgenmzhyuayxxdoq`

The Production Supabase publishable key is configured in the Wrangler Production vars.

A guarded manual deploy workflow now exists at `.github/workflows/deploy-cloudflare-exam-production.yml`. It refuses to deploy unless all of these repository/environment secrets are available:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_SECRET_KEY_PRODUCTION`

The workflow injects `SUPABASE_SECRET_KEY_PRODUCTION` into the Production Wrangler environment as `SUPABASE_SECRET_KEY`, then runs `wrangler deploy --env production` and verifies `/health` against the Production project ref.

Never reuse the DEV Supabase secret.

## Remaining cutover gates

Production traffic remains on the legacy `/api/exam` path until all remaining gates pass:

1. Ensure the three Production deploy secrets above exist in the GitHub `production` environment/repository.
2. Create/validate the Production R2 bucket, Queue and DLQ resources.
3. Build/copy and validate Production R2 exam content against the active release contract.
4. Run the guarded Production deploy workflow.
5. `/health` must report `APP_ENV=production` and Supabase project ref `trnvsgenmzhyuayxxdoq`.
6. Authenticated lifecycle smoke must pass: `prepare -> create -> window -> submit -> flag -> suspend -> resume -> complete`.
7. Queue-to-Supabase materialization must complete with zero sync errors.
8. Only then enable a controlled low-volume rollout with `ROYAL_EXAM_EDGE_ENABLED=true`.

## Rollback

Immediate traffic rollback is server-side:

- set `ROYAL_EXAM_EDGE_ENABLED=false`
- redeploy/reload Vercel environment if required

The existing `/api/exam` implementation remains present during rollout.

Do not drop Edge tables or delete Durable Object state as an emergency rollback action. Leave Edge data intact for diagnosis/reconciliation while routing traffic back to the legacy path.
