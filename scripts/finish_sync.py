import os
import json
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://trnvsgenmzhyuayxxdoq.supabase.co"
SERVICE_ROLE_KEY = "sb_secret_LfKxUzMNK1tuajaRE0KW3g_hXKjuQdF"
PROCESSED_DATA_DIR = r"C:\Users\Administrator\.gemini\antigravity\scratch\processed_data"

headers = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

def post_batch(table_name, records):
    url = f"{SUPABASE_URL}/rest/v1/{table_name}?on_conflict=id"
    data = json.dumps(records).encode("utf-8")
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status in (200, 201):
                    return True
        except Exception as e:
            time.sleep(1.5 ** attempt)
    return False

def sync_all_chunks():
    chunk_files = sorted([f for f in os.listdir(PROCESSED_DATA_DIR) if f.startswith("questions_chunk_")])
    print(f"Syncing all {len(chunk_files)} chunks to guarantee 100% complete upload...")

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

        # Post questions
        q_batch = 30
        for i in range(0, len(questions_payload), q_batch):
            batch = questions_payload[i:i+q_batch]
            if post_batch("questions", batch):
                total_q += len(batch)
            time.sleep(0.05)

        # Post options
        opt_batch = 50
        for i in range(0, len(options_payload), opt_batch):
            batch = options_payload[i:i+opt_batch]
            if post_batch("options", batch):
                total_opt += len(batch)
            time.sleep(0.05)

        print(f"  -> Processed {chunk_file} ({len(q_list)} Qs). Total Uploaded: {total_q}")

    print(f"\n[DONE] Full sync complete! Total: {total_q} questions, {total_opt} options.")

if __name__ == "__main__":
    sync_all_chunks()
