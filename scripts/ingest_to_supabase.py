"""Royal Bank Supabase ingestion CLI.

Uploads processed library articles, questions, and options through the Supabase REST
API. The command is idempotent by primary key and retries transient failures with
exponential backoff, replacing the old direct/resilient/final-sync script variants.

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  PROCESSED_DATA_DIR
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Iterable
from typing import Any


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest Royal Bank processed data into Supabase.")
    parser.add_argument("--skip-library", action="store_true", help="Do not upload library_articles.json.")
    parser.add_argument("--skip-questions", action="store_true", help="Do not upload question chunks.")
    parser.add_argument("--question-batch", type=int, default=30, help="Questions per REST request.")
    parser.add_argument("--option-batch", type=int, default=60, help="Options per REST request.")
    parser.add_argument("--library-batch", type=int, default=50, help="Library articles per REST request.")
    parser.add_argument("--max-retries", type=int, default=5, help="Attempts for transient failures.")
    parser.add_argument("--request-timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument("--pause", type=float, default=0.05, help="Pause between successful batches.")
    return parser.parse_args()


def batches(records: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    if size <= 0:
        raise ValueError("Batch size must be positive.")
    for index in range(0, len(records), size):
        yield records[index:index + size]


class SupabaseIngestClient:
    def __init__(self, *, url: str, service_role_key: str, max_retries: int, timeout: float):
        self.url = url.rstrip("/")
        self.service_role_key = service_role_key
        self.max_retries = max(1, max_retries)
        self.timeout = timeout
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }

    def post_batch(
        self,
        table_name: str,
        records: list[dict[str, Any]],
        *,
        on_conflict: str = "id",
    ) -> None:
        if not records:
            return

        endpoint = f"{self.url}/rest/v1/{table_name}?on_conflict={on_conflict}"
        payload = json.dumps(records).encode("utf-8")
        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            request = urllib.request.Request(
                endpoint,
                data=payload,
                headers=self.headers,
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if response.status in (200, 201):
                        return
                    raise RuntimeError(f"Unexpected HTTP status {response.status} for {table_name}")
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="ignore")[:300]
                last_error = RuntimeError(f"HTTP {exc.code} for {table_name}: {body}")
                if exc.code != 429 and exc.code < 500:
                    break
            except Exception as exc:  # Network failures are retried below.
                last_error = exc

            if attempt + 1 < self.max_retries:
                time.sleep(min(2 ** attempt, 16))

        raise RuntimeError(f"Failed to upload {table_name} after {self.max_retries} attempts") from last_error


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def upload_records(
    client: SupabaseIngestClient,
    table_name: str,
    records: list[dict[str, Any]],
    *,
    batch_size: int,
    pause: float,
) -> int:
    uploaded = 0
    for batch in batches(records, batch_size):
        client.post_batch(table_name, batch)
        uploaded += len(batch)
        if pause > 0:
            time.sleep(pause)
    return uploaded


def ingest_library(
    client: SupabaseIngestClient,
    data_dir: str,
    *,
    batch_size: int,
    pause: float,
) -> None:
    path = os.path.join(data_dir, "library_articles.json")
    if not os.path.exists(path):
        print(f"[SKIP] Library source not found: {path}")
        return

    articles = load_json(path)
    if not isinstance(articles, list):
        raise RuntimeError("library_articles.json must contain a JSON array.")

    print(f"[LIBRARY] Uploading {len(articles)} articles...")
    uploaded = upload_records(
        client,
        "library_articles",
        articles,
        batch_size=batch_size,
        pause=pause,
    )
    print(f"[LIBRARY] Uploaded {uploaded}/{len(articles)} articles.")


def split_question_chunk(raw_questions: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not isinstance(raw_questions, list):
        raise RuntimeError("Question chunk must contain a JSON array.")

    questions: list[dict[str, Any]] = []
    options: list[dict[str, Any]] = []

    for raw_question in raw_questions:
        if not isinstance(raw_question, dict):
            raise RuntimeError("Each question must be a JSON object.")
        question = dict(raw_question)
        raw_options = question.pop("options", [])
        if not isinstance(raw_options, list):
            raise RuntimeError(f"Question {question.get('id')} has a non-array options field.")
        if not all(isinstance(option, dict) for option in raw_options):
            raise RuntimeError(f"Question {question.get('id')} contains an invalid option.")
        questions.append(question)
        options.extend(raw_options)

    return questions, options


def ingest_questions(
    client: SupabaseIngestClient,
    data_dir: str,
    *,
    question_batch_size: int,
    option_batch_size: int,
    pause: float,
) -> None:
    chunk_files = sorted(
        filename
        for filename in os.listdir(data_dir)
        if filename.startswith("questions_chunk_") and filename.endswith(".json")
    )
    if not chunk_files:
        print("[SKIP] No question chunk files found.")
        return

    total_questions = 0
    total_options = 0
    print(f"[QUESTIONS] Processing {len(chunk_files)} chunk files...")

    for chunk_file in chunk_files:
        path = os.path.join(data_dir, chunk_file)
        questions, options = split_question_chunk(load_json(path))

        total_questions += upload_records(
            client,
            "questions",
            questions,
            batch_size=question_batch_size,
            pause=pause,
        )
        total_options += upload_records(
            client,
            "options",
            options,
            batch_size=option_batch_size,
            pause=pause,
        )
        print(
            f"[QUESTIONS] {chunk_file}: {len(questions)} questions, {len(options)} options "
            f"(running totals: {total_questions}/{total_options})"
        )

    print(f"[QUESTIONS] Complete: {total_questions} questions, {total_options} options.")


def main() -> None:
    args = parse_args()
    data_dir = require_env("PROCESSED_DATA_DIR")
    if not os.path.isdir(data_dir):
        raise RuntimeError(f"PROCESSED_DATA_DIR is not a directory: {data_dir}")

    client = SupabaseIngestClient(
        url=require_env("SUPABASE_URL"),
        service_role_key=require_env("SUPABASE_SERVICE_ROLE_KEY"),
        max_retries=args.max_retries,
        timeout=args.request_timeout,
    )

    if not args.skip_library:
        ingest_library(client, data_dir, batch_size=args.library_batch, pause=args.pause)
    if not args.skip_questions:
        ingest_questions(
            client,
            data_dir,
            question_batch_size=args.question_batch,
            option_batch_size=args.option_batch,
            pause=args.pause,
        )


if __name__ == "__main__":
    main()
