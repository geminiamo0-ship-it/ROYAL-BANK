# Royal Content Manager

Desktop importer for Royal question-bank and Library content.

## Branch workflow

This tool is developed on `feature/royal-content-manager`, which is based on `dev`.

Recommended flow:

```text
feature/royal-content-manager
        -> test against DEV Supabase
        -> PR into dev
        -> test full DEV deployment/database
        -> later merge dev -> main
        -> apply the exact same migration files to Production
```

Do not develop this tool directly on `main`.

## What this version does

- Opens a SQLite `.db`, `.sqlite`, or `.sqlite3` file.
- Scans tables and auto-detects likely Questions / Options / Library tables.
- Lets you correct table/column mappings in the UI.
- Blocks import if required structure or integrity checks fail.
- Supports:
  - New Pathway + New Bank
  - New Bank inside Existing Pathway
  - Update Existing Bank
- Previews insert/update/unchanged counts.
- Explicitly reports target questions/articles missing from the source as **LEFT UNTOUCHED**.
- Same Question ID: updates the question and replaces its current option set by `option_order`.
- New Question ID: inserts it.
- Source-missing target Question ID: does not delete or unmap it.
- Same rules for Library articles.
- Ensures bank mappings.
- Creates standard 1/3/6/12/Lifetime catalog plans for newly created Pathway/Bank products if the DB trigger created only the Product.
- Uses server-side transactional import batches.
- Requires typing `PRODUCTION` before any Production import.
- Stores an import JSON log under `~/RoyalContentManager/logs/`.

## Database migration

The matching database API is tracked in Git at:

```text
supabase/migrations/049_royal_content_manager_import_api.sql
```

It is service-role-only. The Python tool should not bypass that API with direct ad-hoc SQL.

## Install

Windows PowerShell:

```powershell
cd tools/royal-content-manager
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
python royal_content_manager.py
```

You can also paste the Supabase URL and service-role key directly in the app. The app does not save those secrets.

## Environment variables

```text
ROYAL_DEV_SUPABASE_URL
ROYAL_DEV_SERVICE_ROLE_KEY
ROYAL_PROD_SUPABASE_URL
ROYAL_PROD_SERVICE_ROLE_KEY
```

Never commit `.env` or real service-role keys.

## Source schema

The importer is intentionally not hard-coded to one SQLite table name. It maps canonical Royal fields to source columns.

Required Questions fields:

- `id`
- `text_html`
- `explanation_html`
- `category`

Optional Questions fields:

- `main_id`, `topic`, `concept`, `concept_id`, `notes_id`, `difficulty`, `source`, `pm_question_id`, `concepts_json`

Required Options fields:

- `question_id`
- `text_html`
- `is_correct`
- `option_order`

Optional Options:

- `percentage`

Optional Library table required fields when enabled:

- `id`
- `name`
- `content_html`

Optional Library fields:

- `category`
- `source`

## Verification rules

Blocking checks include missing required mapped columns, duplicate Question IDs, duplicate non-null `main_id`, questions without options, zero or multiple correct options, duplicate/missing `option_order`, orphan options, empty required question fields, empty option text, invalid percentage, duplicate Library IDs, and missing Library id/name/content.

Unusual difficulty strings are warnings, not blockers, because Royal stores difficulty as text.

## Update semantics

```text
Source question exists + target same ID
    -> update current question
    -> upsert options by (question_id, option_order)
    -> delete stale option orders for that supplied question

Source question is new
    -> insert
    -> map to selected bank

Target question is absent from source
    -> DO NOTHING
    -> do not delete
    -> do not retire
    -> do not unmap
```

The same "missing means untouched" rule applies to Library articles.

If a stale option that must be deleted is referenced by historical data and the database rejects the delete, the server batch fails instead of silently corrupting history.

## Production safety

Use DEV first. Only promote an approved source/batch to Production after verification. Production import requires the exact confirmation text:

```text
PRODUCTION
```
