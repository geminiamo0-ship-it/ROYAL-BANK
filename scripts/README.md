# Maintenance scripts

These scripts are operator tooling, not application runtime code. Keep credentials in environment variables only; never hard-code or commit service-role, R2, gateway, or access-token values.

## Supabase ingestion

`ingest_to_supabase.py` is the single supported ingestion entrypoint for processed Royal Bank content. It uploads library content, `questions_chunk_*.json`, and options idempotently with retry/backoff.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROCESSED_DATA_DIR`

### New SQLite library format

The preferred library source is a SQLite `.db`, `.sqlite`, or `.sqlite3` file containing one table with these columns:

- `main_id` — must match `public.questions.main_id` in the target Supabase project.
- `library` — article/library display name.
- `topic` — source topic name.
- `category` — category/subject name.
- `content` — article HTML/body to store in `library_articles.content_html`.

If `--library-db` is omitted, the uploader auto-discovers exactly one SQLite file inside `PROCESSED_DATA_DIR`. If `--library-table` is omitted, it auto-detects the one table containing all five required columns.

During SQLite ingestion the uploader:

1. validates and deduplicates article rows by `category + topic + library`;
2. generates a deterministic article ID;
3. matches every source `main_id` against Production `questions.main_id`;
4. reports topic/category mismatches without blocking by default;
5. discovers the question bank containing each matched question;
6. upserts `library_articles` and the required `question_bank_library_articles` mappings.

Example for a library-only upload:

```bash
python scripts/ingest_to_supabase.py \
  --library-db /path/to/library.db \
  --skip-questions
```

If the DB is the only SQLite file in `PROCESSED_DATA_DIR`, this is enough:

```bash
python scripts/ingest_to_supabase.py --skip-questions
```

Use `--strict-library-validation` when you want any missing `main_id` or topic/category mismatch to stop the import instead of being reported as a warning.

Legacy `library_articles.json` remains supported as a fallback when no SQLite source exists, but legacy JSON mode does not infer bank mappings.

Other useful flags include configurable batch sizes, timeout, retry count, inter-batch pause, `--skip-library`, and `--skip-questions`. Run `python scripts/ingest_to_supabase.py --help` for the current interface.

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
