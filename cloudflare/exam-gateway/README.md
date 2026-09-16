# Royal Bank Cloudflare Exam Gateway

This directory is the Cloudflare exam runtime for the canonical `ROYAL-BANK` repository.

## Current safety boundary

The committed Wrangler configuration is intentionally **DEV-only** and reuses the isolated V2 Cloudflare resources while the architecture is transplanted into `ROYAL-BANK`:

- Supabase project: `ROYAL-BANK-DEV` (`dcttiqdrsvkufzjahjzw`)
- Worker: `royal-bank-v2-exam`
- R2 bucket: `royal-bank-v2-exam-content`
- Queue: `royal-bank-v2-exam-sync`
- DLQ: `royal-bank-v2-exam-sync-dlq`

Production bindings are deliberately not committed yet. This prevents an accidental production deploy during migration.

The runtime itself is no longer hard-coded to the DEV project. It validates `SUPABASE_URL` against `SUPABASE_PROJECT_REF`, so every environment must explicitly provide a matching project identity before JWT verification or sync can proceed.

## Architecture

`Client -> Cloudflare Worker -> Supabase JWT verification -> one UserExamState Durable Object per user -> R2 immutable release content`

The Worker uses Supabase for JWT verification and a lightweight entitlement RPC during prepare/create revalidation. Selection, idempotency, per-user security counters, session state, answers, flags, seen/incorrect state, and scoring run inside the user's SQLite-backed Durable Object. Question and feedback content are read from immutable R2 release objects.

One Durable Object per user serializes that user's mutations and security counters while distributing different users across independent objects. There is no global session object in the hot path.

## R2 contract

The DEV bucket uses `EXAM_CONTENT_ROOT=exam-content-v2` and contains:

- `exam-content-v2/active.json`
- `<release-prefix>/questions/<question-id>.json`
- `<release-prefix>/feedback/<question-id>.json`
- `<release-prefix>/selection/banks/<bank-id>.json`

The selection index contains only metadata needed to select question IDs at the edge and must never contain answer correctness.

## Sync path

Durable Object mutations are written to the local SQLite outbox, published to Cloudflare Queues in batches, then delivered to `ingest_edge_exam_sync_batch` in Supabase. The materialized Slim History tables remain the long-term history/analytics representation.

## Required configuration

`SUPABASE_SECRET_KEY` must be configured as a Worker secret. Environment variables/bindings must include `APP_ENV`, `SERVICE_NAME`, `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EXAM_CONTENT_ROOT`, `EXAM_SYNC_QUEUE_NAME`, `USER_EXAMS`, `EXAM_CONTENT`, and `EXAM_SYNC_QUEUE`.

Before adding a production Wrangler environment, provision separate production Worker/DO, R2, Queue and DLQ resources and set the production Supabase project ref explicitly. Do not reuse the DEV resources for production.
