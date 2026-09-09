# Maintenance scripts

These scripts are operator tooling, not application runtime code. Keep credentials in environment variables only; never hard-code or commit service-role, R2, gateway, or access-token values.

## Supabase ingestion

`ingest_to_supabase.py` is the single supported ingestion entrypoint for processed Royal Bank content. It uploads `library_articles.json` and `questions_chunk_*.json` idempotently with retry/backoff.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROCESSED_DATA_DIR`

Useful flags include `--skip-library`, `--skip-questions`, configurable batch sizes, timeout, retry count, and inter-batch pause. Run `python scripts/ingest_to_supabase.py --help` for the current interface.

## Cloudflare R2 media upload

`upload_r2.py` uploads the contents of the configured local media directory under the `offline_media/` object prefix.

Required environment variables:

- `R2_ENDPOINT_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_MEDIA_FOLDER`

The uploader requires Python packages `boto3` and `botocore`. Install them in the operator environment rather than vendoring them into the web application.

## CI audits

- `audit-client-boundary.mjs` prevents browser bundles from regaining direct backend/Supabase access.
- `audit-exam-architecture.mjs` protects the single windowed Exam architecture and its extracted boundaries.
- `audit-repo-hygiene.mjs` prevents known retired files/debug artifacts from returning and limits oversized React components.

These audits are part of `npm run verify`; update the guards intentionally when architecture changes rather than bypassing them.
