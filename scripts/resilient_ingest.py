"""
Royal Bank - Resilient Supabase Ingestion Engine
================================================
Completes uploading remaining question chunks with retry logic and rate-limit backoff.
Credentials and the local data directory come from environment variables.
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


def post_batch_with_retry(
    table_name: str,
    records: list,
    on_conflict: str | None = None,
    max_retries: int = 5,
) -> bool:
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

    for attempt in range(max_retries):
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    return True
        except urllib.error.HTTPError as exc:
            if exc.code == 429 or exc.code >= 500:
                time.sleep(2 ** attempt)
                continue
            return False
        except Exception:
            time.sleep(2 ** attempt)
            continue

    return False


def run_full_ingestion():
    chunk_files = sorted(
        filename for filename in os.listdir(PROCESSED_DATA_DIR)
        if filename.startswith("questions_chunk_")
    )
    print(f"Ingesting {len(chunk_files)} question chunks...")

    total_q = 0
    total_opt = 0

    for chunk_file in chunk_files:
        path = os.path.join(PROCESSED_DATA_DIR, chunk_file)
        with open(path, "r", encoding="utf-8") as handle:
            q_list = json.load(handle)

        questions_payload = []
        options_payload = []
        for question in q_list:
            question_copy = dict(question)
            options = question_copy.pop("options", [])
            questions_payload.append(question_copy)
            options_payload.extend(options)

        for i in range(0, len(questions_payload), 25):
            batch = questions_payload[i:i + 25]
            if post_batch_with_retry("questions", batch, on_conflict="id"):
                total_q += len(batch)
            time.sleep(0.1)

        for i in range(0, len(options_payload), 50):
            batch = options_payload[i:i + 50]
            if post_batch_with_retry("options", batch, on_conflict="id"):
                total_opt += len(batch)
            time.sleep(0.05)

        print(f"Chunk {chunk_file} uploaded. Total Questions: {total_q}, Options: {total_opt}")

    print(f"Ingestion Completed! Total: {total_q} questions, {total_opt} options.")


if __name__ == "__main__":
    run_full_ingestion()
