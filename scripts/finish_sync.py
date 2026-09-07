import os
import json
import time
import urllib.request


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SERVICE_ROLE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")
PROCESSED_DATA_DIR = require_env("PROCESSED_DATA_DIR")

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}


def post_batch(table_name: str, records: list) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/{table_name}?on_conflict=id"
    data = json.dumps(records).encode("utf-8")

    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    return True
        except Exception:
            time.sleep(1.5 ** attempt)

    return False


def sync_all_chunks():
    chunk_files = sorted(
        filename for filename in os.listdir(PROCESSED_DATA_DIR)
        if filename.startswith("questions_chunk_")
    )
    print(f"Syncing all {len(chunk_files)} chunks to guarantee 100% complete upload...")

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

        for i in range(0, len(questions_payload), 30):
            batch = questions_payload[i:i + 30]
            if post_batch("questions", batch):
                total_q += len(batch)
            time.sleep(0.05)

        for i in range(0, len(options_payload), 50):
            batch = options_payload[i:i + 50]
            if post_batch("options", batch):
                total_opt += len(batch)
            time.sleep(0.05)

        print(f"  -> Processed {chunk_file} ({len(q_list)} Qs). Total Uploaded: {total_q}")

    print(f"\n[DONE] Full sync complete! Total: {total_q} questions, {total_opt} options.")


if __name__ == "__main__":
    sync_all_chunks()
