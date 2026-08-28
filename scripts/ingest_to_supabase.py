"""
Royal Bank - Direct Supabase Batch Ingestion Engine
===================================================
Streams questions, options, and library articles directly to Supabase REST API
using the service_role key with optimized batching and error recovery.
"""

import os
import json
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://trnvsgenmzhyuayxxdoq.supabase.co"
SERVICE_ROLE_KEY = "sb_secret_LfKxUzMNK1tuajaRE0KW3g_hXKjuQdF"
PROCESSED_DATA_DIR = r"C:\Users\Administrator\.gemini\antigravity\scratch\processed_data"


def post_batch(table_name: str, records: list, on_conflict: str = None) -> bool:
    """Post a batch of records to Supabase table via REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table_name}"
    if on_conflict:
        url += f"?on_conflict={on_conflict}"

    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    data_bytes = json.dumps(records).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        print(f"  [ERROR] {table_name} (status {e.code}): {err_body[:300]}")
        return False
    except Exception as e:
        print(f"  [ERROR] Connection error on {table_name}: {e}")
        return False


def import_library_articles():
    path = os.path.join(PROCESSED_DATA_DIR, "library_articles.json")
    if not os.path.exists(path):
        print(f"[SKIP] {path} not found.")
        return

    with open(path, "r", encoding="utf-8") as f:
        articles = json.load(f)

    print(f"\n[1/2] Ingesting {len(articles)} Textbook Library Articles...")
    batch_size = 50
    success_count = 0

    for i in range(0, len(articles), batch_size):
        batch = articles[i:i + batch_size]
        ok = post_batch("library_articles", batch, on_conflict="id")
        if ok:
            success_count += len(batch)
            print(f"  -> Uploaded articles {i+1} to {min(i+batch_size, len(articles))} of {len(articles)}")
        else:
            print(f"  [FAILED] Batch starting at index {i}")
        time.sleep(0.1)

    print(f"[DONE] Ingested {success_count}/{len(articles)} library articles.")


def import_questions_and_options():
    print(f"\n[2/2] Ingesting Questions and Options...")
    chunk_files = sorted([f for f in os.listdir(PROCESSED_DATA_DIR) if f.startswith("questions_chunk_")])
    if not chunk_files:
        print("[SKIP] No question chunk files found.")
        return

    total_q_uploaded = 0
    total_opt_uploaded = 0

    for chunk_file in chunk_files:
        path = os.path.join(PROCESSED_DATA_DIR, chunk_file)
        with open(path, "r", encoding="utf-8") as f:
            q_list = json.load(f)

        print(f"\nProcessing {chunk_file} ({len(q_list)} questions)...")

        # 1. Prepare questions payload (excluding options)
        questions_payload = []
        options_payload = []
        for q in q_list:
            q_copy = dict(q)
            opts = q_copy.pop("options", [])
            questions_payload.append(q_copy)
            for opt in opts:
                options_payload.append(opt)

        # Upload questions in sub-batches of 50
        q_batch_size = 50
        for i in range(0, len(questions_payload), q_batch_size):
            q_batch = questions_payload[i:i + q_batch_size]
            ok = post_batch("questions", q_batch, on_conflict="id")
            if ok:
                total_q_uploaded += len(q_batch)
            else:
                print(f"  [FAILED] Questions sub-batch starting at {i}")
            time.sleep(0.05)

        # Upload options in sub-batches of 100
        opt_batch_size = 100
        for i in range(0, len(options_payload), opt_batch_size):
            opt_batch = options_payload[i:i + opt_batch_size]
            ok = post_batch("options", opt_batch, on_conflict="id")
            if ok:
                total_opt_uploaded += len(opt_batch)
            else:
                print(f"  [FAILED] Options sub-batch starting at {i}")
            time.sleep(0.05)

        print(f"  Progress: Total Questions Uploaded = {total_q_uploaded}, Options = {total_opt_uploaded}")

    print(f"\n==================================================")
    print(f"[COMPLETE] Questions Ingested: {total_q_uploaded}")
    print(f"[COMPLETE] Options Ingested:   {total_opt_uploaded}")
    print(f"==================================================")


if __name__ == "__main__":
    print("==================================================")
    print(" Royal Bank - Supabase Direct Cloud Ingestion Engine")
    print(f" Target URL: {SUPABASE_URL}")
    print("==================================================")
    import_library_articles()
    import_questions_and_options()
