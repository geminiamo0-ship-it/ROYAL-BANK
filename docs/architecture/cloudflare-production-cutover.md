# Cloudflare Exam Production Cutover Manifest

Status: **Production Edge database schema applied; Cloudflare Production deploy and traffic cutover still pending**

Production Supabase project: `trnvsgenmzhyuayxxdoq`.

## Completed

- Final Production preflight returned `ready: true`.
- All 10 Production auth users had matching `profiles` rows at migration time.
- Existing Production business/auth/performance functions were preserved.
- The following Edge migrations were applied successfully, in order:
  1. `v2_edge_exam_sync_inbox`
  2. `v2_edge_exam_history_materializer`
  3. `v2_completion_snapshot_questions`
  4. `v2_slim_history_bridge_core`
  5. `v2_slim_history_materializer`
  6. `v2_slim_history_read_bridge`
  7. `fix_v2_slim_history_state_ambiguity`
  8. `v2_edge_user_lifecycle_cleanup`
  9. `v2_compact_sync_inbox_retention`
- Post-migration verification passed:
  - all 7 Edge tables exist
  - RLS is enabled on all 7 Edge tables
  - required Edge RPC/functions exist
  - 6 profile foreign keys exist
  - `ingest_edge_exam_sync_batch(jsonb)` is denied to `anon` and `authenticated`, allowed to `service_role`
  - sync inbox immediately after rollout: 0 total / 0 pending / 0 errors

Do not run a blind `supabase db push` against Production because DEV and Production have different historical migration records.

## Production functions intentionally preserved

Do **not** replace these as part of the Edge cutover:

- `public.can_access_question_bank(bigint)`
- `public.is_active_user()`
- `public.mark_question_bank_dashboard_dirty(uuid,bigint)`
- `public.get_question_bank_performance(bigint)`

Production `mark_question_bank_dashboard_dirty` invalidates both dashboard and performance caches, and Production `get_question_bank_performance` retains the cache/advisory-lock wrapper.

## Cloudflare Production configuration

Configured in `cloudflare/exam-gateway/wrangler.jsonc` under `env.production`:

- Worker: `royal-bank-exam-production`
- R2 bucket: `royal-bank-exam-production-content`
- Queue: `royal-bank-exam-production-sync`
- DLQ: `royal-bank-exam-production-sync-dlq`
- Durable Object binding: `USER_EXAMS`
- Supabase ref: `trnvsgenmzhyuayxxdoq`
- Production Supabase publishable key is present in Production vars.

A guarded manual workflow exists at `.github/workflows/deploy-cloudflare-exam-production.yml`.

It refuses to deploy unless these secrets are present:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_SECRET_KEY_PRODUCTION`

The workflow writes the Production Supabase secret to Wrangler as `SUPABASE_SECRET_KEY`, deploys with `--env production`, then verifies `/health` against the Production project ref.

Never reuse the DEV Supabase secret.

## Remaining gates before Production traffic

Production remains on the legacy `/api/exam` path until all gates below pass:

1. Ensure the three Production deploy secrets exist in GitHub.
2. Create/validate Production R2, Queue and DLQ resources.
3. Populate and validate Production R2 exam content/active release.
4. Run the guarded Production deploy workflow.
5. `/health` must report `environment=production` and Supabase ref `trnvsgenmzhyuayxxdoq`.
6. Run authenticated lifecycle smoke: `prepare -> create -> window -> submit -> flag -> suspend -> resume -> complete`.
7. Verify Queue -> Supabase materialization and zero sync errors.
8. Only then enable a controlled rollout with `ROYAL_EXAM_EDGE_ENABLED=true`.

## Rollback

Immediate traffic rollback remains:

- set `ROYAL_EXAM_EDGE_ENABLED=false`
- redeploy/reload Vercel environment if needed

The legacy `/api/exam` implementation remains available during rollout. Do not drop Edge tables or delete Durable Object state as an emergency rollback step.
