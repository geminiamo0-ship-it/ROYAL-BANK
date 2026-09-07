"""
Royal Bank - Direct Supabase Batch Ingestion Engine
===================================================
Streams questions, options, and library articles directly to Supabase REST API
using credentials supplied through environment variables.
"""

import os
import json
import time
import urllib.request
import urllib.error


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SERVICE_ROLE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")
PROCESSED_DATA_DIR = require_env("PROCESSED_DATA_DIR")


def post_batch(table_name: str, records: list, on_conflict: str | None = None) -> bool:
    """Post a batch of records to Supabase table via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table_name}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"

    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    data_bytes = json.dumps(records).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        print(f"  [ERROR] {table_name} (status {exc.code}): {err_body[:300]}")
        return False
    except Exception as exc:
        print(f"  [ERROR] Connection error on {table_name}: {exc}")
        return False


def import_library_articles():
    path = os.path.join(PROCESSED_DATA_DIR, "library_articles.json")
    if not os.path.exists(path):
        print(f"[SKIP] {path} not found.")
        return

    with open(path, "r", encoding="utf-8") as handle:
        articles = json.load(handle)

    print(f"\n[1/2] Ingesting {len(articles)} Textbook Library Articles...")
    batch_size = 50
    success_count = 0

    for i in range(0, len(articles), batch_size):
        batch = articles[i:i + batch_size]
        ok = post_batch("library_articles", batch, on_conflict="id")
        if ok:
            success_count += len(batch)
            print(f"  -> Uploaded articles {i + 1} to {min(i + batch_size, len(articles))} of {len(articles)}")
        else:
            print(f"  [FAILED] Batch starting at index {i}")
        time.sleep(0.1)

    print(f"[DONE] Ingested {success_count}/{len(articles)} library articles.")


def import_questions_and_options():
    print("\n[2/2] Ingesting Questions and Options...")
    chunk_files = sorted(
        filename for filename in os.listdir(PROCESSED_DATA_DIR)
        if filename.startswith("questions_chunk_")
    )
    if not chunk_files:
        print("[SKIP] No question chunk files found.")
        return

    total_q_uploaded = 0
    total_opt_uploaded = 0

    for chunk_file in chunk_files:
        path = os.path.join(PROCESSED_DATA_DIR, chunk_file)
        with open(path, "r", encoding="utf-8") as handle:
            q_list = json.load(handle)

        print(f"\nProcessing {chunk_file} ({len(q_list)} questions)...")
        questions_payload = []
        options_payload = []

        for question in q_list:
            question_copy = dict(question)
            options = question_copy.pop("options", [])
            questions_payload.append(question_copy)
            options_payload.extend(options)

        for i in range(0, len(questions_payload), 50):
            batch = questions_payload[i:i + 50]
            if post_batch("questions", batch, on_conflict="id"):
                total_q_uploaded += len(batch)
            else:
                print(f"  [FAILED] Questions sub-batch starting at {i}")
            time.sleep(0.05)

        for i in range(0, len(options_payload), 100):
            batch = options_payload[i:i + 100]
            if post_batch("options", batch, on_conflict="id"):
                total_opt_uploaded += len(batch)
            else:
                print(f"  [FAILED] Options sub-batch starting at {i}")
            time.sleep(0.05)

        print(f"  Progress: Total Questions Uploaded = {total_q_uploaded}, Options = {total_opt_uploaded}")

    print("\n==================================================")
    print(f"[COMPLETE] Questions Ingested: {total_q_uploaded}")
    print(f"[COMPLETE] Options Ingested:   {total_opt_uploaded}")
    print("==================================================")


if __name__ == "__main__":
    print("==================================================")
    print(" Royal Bank - Supabase Direct Cloud Ingestion Engine")
    print(f" Target URL: {SUPABASE_URL}")
    print("==================================================")
    import_library_articles()
    import_questions_and_options()
