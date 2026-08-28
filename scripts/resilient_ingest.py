"""
Royal Bank - Resilient Supabase Ingestion Engine
================================================
Completes uploading all remaining question chunks with retry logic and rate limit backoff.
"""

import os
import json
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://trnvsgenmzhyuayxxdoq.supabase.co"
SERVICE_ROLE_KEY = "sb_secret_LfKxUzMNK1tuajaRE0KW3g_hXKjuQdF"
PROCESSED_DATA_DIR = r"C:\Users\Administrator\.gemini\antigravity\scratch\processed_data"


def post_batch_with_retry(table_name: str, records: list, on_conflict: str = None, max_retries: int = 5) -> bool:
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

    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    return True
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            return False
        except Exception:
            time.sleep(2 ** attempt)
            continue

    return False


def run_full_ingestion():
    chunk_files = sorted([f for f in os.listdir(PROCESSED_DATA_DIR) if f.startswith("questions_chunk_")])
    print(f"Ingesting {len(chunk_files)} question chunks...")

    total_q = 0
    total_opt = 0

    for chunk_file in chunk_files:
        path = os.path.join(PROCESSED_DATA_DIR, chunk_file)
        with open(path, "r", encoding="utf-8") as f:
            q_list = json.load(f)

        questions_payload = []
        options_payload = []
        for q in q_list:
            q_copy = dict(q)
            opts = q_copy.pop("options", [])
            questions_payload.append(q_copy)
            for opt in opts:
                options_payload.append(opt)

        # Upload questions in sub-batches of 25
        q_batch_size = 25
        for i in range(0, len(questions_payload), q_batch_size):
            q_batch = questions_payload[i:i + q_batch_size]
            if post_batch_with_retry("questions", q_batch, on_conflict="id"):
                total_q += len(q_batch)
            time.sleep(0.1)

        # Upload options in sub-batches of 50
        opt_batch_size = 50
        for i in range(0, len(options_payload), opt_batch_size):
            opt_batch = options_payload[i:i + opt_batch_size]
            if post_batch_with_retry("options", opt_batch, on_conflict="id"):
                total_opt += len(opt_batch)
            time.sleep(0.05)

        print(f"Chunk {chunk_file} uploaded. Total Questions: {total_q}, Options: {total_opt}")

    print(f"Ingestion Completed! Total: {total_q} questions, {total_opt} options.")


if __name__ == "__main__":
    run_full_ingestion()
