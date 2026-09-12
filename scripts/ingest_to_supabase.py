"""Royal Bank Supabase ingestion CLI.

Uploads processed library content, questions, and options through the Supabase REST API.
The command is idempotent and retries transient failures with exponential backoff.

New library ingestion supports a SQLite database containing a table with these columns:
  main_id, library, topic, category, content

`main_id` is matched to public.questions.main_id in the target Supabase project. Articles
are deduplicated by (category, topic, library), uploaded to public.library_articles, and
mapped automatically to the question bank(s) that contain their matched questions.

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  PROCESSED_DATA_DIR
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable
from typing import Any


LIBRARY_REQUIRED_COLUMNS = {"main_id", "library", "topic", "category", "content"}
SQLITE_EXTENSIONS = (".db", ".sqlite", ".sqlite3")


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest Royal Bank processed data into Supabase.")
    parser.add_argument("--skip-library", action="store_true", help="Do not upload library content.")
    parser.add_argument("--skip-questions", action="store_true", help="Do not upload question chunks.")
    parser.add_argument(
        "--library-db",
        help=(
            "SQLite library DB path. If omitted, exactly one .db/.sqlite/.sqlite3 file "
            "inside PROCESSED_DATA_DIR is auto-discovered. Falls back to library_articles.json "
            "when no SQLite DB is found."
        ),
    )
    parser.add_argument(
        "--library-table",
        help="SQLite table containing main_id, library, topic, category, content. Auto-detected if omitted.",
    )
    parser.add_argument(
        "--library-source",
        default="Royal Library",
        help="Value stored in library_articles.source for SQLite imports.",
    )
    parser.add_argument(
        "--strict-library-validation",
        action="store_true",
        help="Fail if a source main_id is missing in Production or topic/category differs from Production.",
    )
    parser.add_argument("--question-batch", type=int, default=30, help="Questions per REST request.")
    parser.add_argument("--option-batch", type=int, default=60, help="Options per REST request.")
    parser.add_argument("--library-batch", type=int, default=50, help="Library articles/mappings per REST request.")
    parser.add_argument(
        "--library-query-batch",
        type=int,
        default=200,
        help="IDs per validation/mapping lookup request.",
    )
    parser.add_argument("--max-retries", type=int, default=5, help="Attempts for transient failures.")
    parser.add_argument("--request-timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument("--pause", type=float, default=0.05, help="Pause between successful batches.")
    return parser.parse_args()


def batches(records: list[Any], size: int) -> Iterable[list[Any]]:
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
        self.base_headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
        }

    def _request(
        self,
        endpoint: str,
        *,
        method: str,
        payload: bytes | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> bytes:
        headers = dict(self.base_headers)
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)

        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            request = urllib.request.Request(
                endpoint,
                data=payload,
                headers=headers,
                method=method,
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    if 200 <= response.status < 300:
                        return response.read()
                    raise RuntimeError(f"Unexpected HTTP status {response.status} for {endpoint}")
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="ignore")[:500]
                last_error = RuntimeError(f"HTTP {exc.code} for {endpoint}: {body}")
                if exc.code != 429 and exc.code < 500:
                    break
            except Exception as exc:  # Network failures are retried below.
                last_error = exc

            if attempt + 1 < self.max_retries:
                time.sleep(min(2 ** attempt, 16))

        raise RuntimeError(f"Request failed after {self.max_retries} attempts: {endpoint}") from last_error

    def post_batch(
        self,
        table_name: str,
        records: list[dict[str, Any]],
        *,
        on_conflict: str = "id",
    ) -> None:
        if not records:
            return

        query = urllib.parse.urlencode({"on_conflict": on_conflict}, safe=",")
        endpoint = f"{self.url}/rest/v1/{table_name}?{query}"
        payload = json.dumps(records, ensure_ascii=False).encode("utf-8")
        self._request(
            endpoint,
            method="POST",
            payload=payload,
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )

    def get_records(
        self,
        table_name: str,
        *,
        select: str,
        filters: list[tuple[str, str]],
    ) -> list[dict[str, Any]]:
        query_items = [("select", select), *filters]
        query = urllib.parse.urlencode(query_items, doseq=True, safe="(),.*")
        endpoint = f"{self.url}/rest/v1/{table_name}?{query}"
        raw = self._request(endpoint, method="GET")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
            raise RuntimeError(f"Unexpected response shape from {table_name}")
        return data


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
    on_conflict: str = "id",
) -> int:
    uploaded = 0
    for batch in batches(records, batch_size):
        client.post_batch(table_name, batch, on_conflict=on_conflict)
        uploaded += len(batch)
        if pause > 0:
            time.sleep(pause)
    return uploaded


def quote_sqlite_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def sqlite_table_columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
    quoted = quote_sqlite_identifier(table_name)
    rows = connection.execute(f"PRAGMA table_info({quoted})").fetchall()
    return {str(row[1]).lower() for row in rows}


def discover_library_table(connection: sqlite3.Connection, explicit_table: str | None) -> str:
    table_rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    tables = [str(row[0]) for row in table_rows]

    if explicit_table:
        if explicit_table not in tables:
            raise RuntimeError(f"SQLite table not found: {explicit_table}")
        columns = sqlite_table_columns(connection, explicit_table)
        missing = LIBRARY_REQUIRED_COLUMNS - columns
        if missing:
            raise RuntimeError(
                f"SQLite table {explicit_table!r} is missing required columns: {', '.join(sorted(missing))}"
            )
        return explicit_table

    candidates = [
        table_name
        for table_name in tables
        if LIBRARY_REQUIRED_COLUMNS.issubset(sqlite_table_columns(connection, table_name))
    ]
    if not candidates:
        raise RuntimeError(
            "No SQLite table contains all required library columns: "
            + ", ".join(sorted(LIBRARY_REQUIRED_COLUMNS))
        )
    if len(candidates) > 1:
        raise RuntimeError(
            "Multiple SQLite tables match the library schema. Pass --library-table explicitly: "
            + ", ".join(candidates)
        )
    return candidates[0]


def discover_library_db(data_dir: str, explicit_path: str | None) -> str | None:
    if explicit_path:
        path = explicit_path if os.path.isabs(explicit_path) else os.path.join(data_dir, explicit_path)
        if not os.path.isfile(path):
            raise RuntimeError(f"Library SQLite DB not found: {path}")
        return path

    candidates = sorted(
        os.path.join(data_dir, filename)
        for filename in os.listdir(data_dir)
        if filename.lower().endswith(SQLITE_EXTENSIONS) and os.path.isfile(os.path.join(data_dir, filename))
    )
    if not candidates:
        return None
    if len(candidates) > 1:
        names = ", ".join(os.path.basename(path) for path in candidates)
        raise RuntimeError(f"Multiple SQLite DB files found. Pass --library-db explicitly: {names}")
    return candidates[0]


def clean_required_text(value: Any, *, field: str, row_number: int) -> str:
    if value is None:
        raise RuntimeError(f"Library row {row_number}: {field} is NULL")
    text = str(value).strip()
    if not text:
        raise RuntimeError(f"Library row {row_number}: {field} is empty")
    return text


def parse_main_id(value: Any, *, row_number: int) -> int:
    if isinstance(value, bool):
        raise RuntimeError(f"Library row {row_number}: invalid main_id {value!r}")
    try:
        if isinstance(value, float):
            if not value.is_integer():
                raise ValueError
            main_id = int(value)
        elif isinstance(value, int):
            main_id = value
        else:
            main_id = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            f"Library row {row_number}: main_id must match Production questions.main_id (BIGINT), got {value!r}"
        ) from exc
    if main_id <= 0:
        raise RuntimeError(f"Library row {row_number}: main_id must be positive, got {main_id}")
    return main_id


def load_library_db_rows(db_path: str, table_name: str | None) -> tuple[str, list[dict[str, Any]]]:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        resolved_table = discover_library_table(connection, table_name)
        quoted_table = quote_sqlite_identifier(resolved_table)
        rows = connection.execute(
            f"SELECT main_id, library, topic, category, content FROM {quoted_table}"
        ).fetchall()
    finally:
        connection.close()

    normalized: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows, start=1):
        normalized.append(
            {
                "main_id": parse_main_id(row["main_id"], row_number=row_number),
                "library": clean_required_text(row["library"], field="library", row_number=row_number),
                "topic": clean_required_text(row["topic"], field="topic", row_number=row_number),
                "category": clean_required_text(row["category"], field="category", row_number=row_number),
                "content": clean_required_text(row["content"], field="content", row_number=row_number),
            }
        )
    if not normalized:
        raise RuntimeError(f"SQLite table {resolved_table!r} contains no library rows")
    return resolved_table, normalized


def make_article_id(*, category: str, topic: str, library: str) -> str:
    identity = "\x1f".join((category, topic, library)).encode("utf-8")
    return "lib_" + hashlib.sha256(identity).hexdigest()[:32]


def prepare_library_articles(
    rows: list[dict[str, Any]],
    *,
    source: str,
) -> tuple[list[dict[str, Any]], dict[int, str]]:
    articles_by_id: dict[str, dict[str, Any]] = {}
    article_by_main_id: dict[int, str] = {}

    for row in rows:
        article_id = make_article_id(
            category=str(row["category"]),
            topic=str(row["topic"]),
            library=str(row["library"]),
        )
        article = {
            "id": article_id,
            "name": row["library"],
            "category": row["category"],
            "topic": row["topic"],
            "content_html": row["content"],
            "source": source,
        }
        existing = articles_by_id.get(article_id)
        if existing is not None and existing != article:
            raise RuntimeError(
                "Conflicting content for the same library identity "
                f"({row['category']} / {row['topic']} / {row['library']})."
            )
        articles_by_id[article_id] = article

        main_id = int(row["main_id"])
        existing_article_id = article_by_main_id.get(main_id)
        if existing_article_id is not None and existing_article_id != article_id:
            raise RuntimeError(
                f"main_id {main_id} maps to multiple library articles in the source DB."
            )
        article_by_main_id[main_id] = article_id

    articles = sorted(
        articles_by_id.values(),
        key=lambda article: (
            str(article["category"]).casefold(),
            str(article["topic"]).casefold(),
            str(article["name"]).casefold(),
            str(article["id"]),
        ),
    )
    return articles, article_by_main_id


def fetch_production_questions(
    client: SupabaseIngestClient,
    main_ids: list[int],
    *,
    query_batch_size: int,
) -> dict[int, dict[str, Any]]:
    matched: dict[int, dict[str, Any]] = {}
    for chunk in batches(main_ids, query_batch_size):
        in_filter = "in.(" + ",".join(str(value) for value in chunk) + ")"
        rows = client.get_records(
            "questions",
            select="id,main_id,topic,category",
            filters=[("main_id", in_filter)],
        )
        for row in rows:
            if row.get("main_id") is None:
                continue
            main_id = int(row["main_id"])
            if main_id in matched:
                raise RuntimeError(f"Production contains duplicate questions.main_id={main_id}")
            matched[main_id] = row
    return matched


def validate_library_rows(
    rows: list[dict[str, Any]],
    production_questions: dict[int, dict[str, Any]],
    *,
    strict: bool,
) -> list[int]:
    missing_main_ids: set[int] = set()
    topic_mismatches: list[tuple[int, str, str]] = []
    category_mismatches: list[tuple[int, str, str]] = []

    for row in rows:
        main_id = int(row["main_id"])
        production = production_questions.get(main_id)
        if production is None:
            missing_main_ids.add(main_id)
            continue

        source_topic = str(row["topic"]).strip()
        production_topic = str(production.get("topic") or "").strip()
        if source_topic != production_topic:
            topic_mismatches.append((main_id, source_topic, production_topic))

        source_category = str(row["category"]).strip()
        production_category = str(production.get("category") or "").strip()
        if source_category != production_category:
            category_mismatches.append((main_id, source_category, production_category))

    if missing_main_ids:
        sample = ", ".join(str(value) for value in sorted(missing_main_ids)[:10])
        print(f"[WARN] {len(missing_main_ids)} source main_id values are missing in Production. Sample: {sample}")
    if topic_mismatches:
        sample = "; ".join(
            f"{main_id}: source={source!r}, production={production!r}"
            for main_id, source, production in topic_mismatches[:5]
        )
        print(f"[WARN] {len(topic_mismatches)} topic mismatches. Sample: {sample}")
    if category_mismatches:
        sample = "; ".join(
            f"{main_id}: source={source!r}, production={production!r}"
            for main_id, source, production in category_mismatches[:5]
        )
        print(f"[WARN] {len(category_mismatches)} category mismatches. Sample: {sample}")

    if strict and (missing_main_ids or topic_mismatches or category_mismatches):
        raise RuntimeError("Strict library validation failed; fix the warnings above before upload.")

    return sorted(set(production_questions) - missing_main_ids)


def fetch_question_bank_memberships(
    client: SupabaseIngestClient,
    question_ids: list[int],
    *,
    query_batch_size: int,
) -> dict[int, set[int]]:
    memberships: dict[int, set[int]] = {}
    for chunk in batches(question_ids, query_batch_size):
        in_filter = "in.(" + ",".join(str(value) for value in chunk) + ")"
        rows = client.get_records(
            "question_bank_questions",
            select="question_id,question_bank_id",
            filters=[("question_id", in_filter)],
        )
        for row in rows:
            question_id = int(row["question_id"])
            bank_id = int(row["question_bank_id"])
            memberships.setdefault(question_id, set()).add(bank_id)
    return memberships


def build_library_bank_mappings(
    *,
    articles: list[dict[str, Any]],
    article_by_main_id: dict[int, str],
    production_questions: dict[int, dict[str, Any]],
    memberships_by_question_id: dict[int, set[int]],
) -> tuple[list[dict[str, Any]], set[str]]:
    display_order_by_article = {
        str(article["id"]): index
        for index, article in enumerate(articles)
    }
    mapping_keys: set[tuple[int, str]] = set()
    mapped_articles: set[str] = set()

    for main_id, article_id in article_by_main_id.items():
        production = production_questions.get(main_id)
        if production is None:
            continue
        question_id = int(production["id"])
        for bank_id in memberships_by_question_id.get(question_id, set()):
            mapping_keys.add((bank_id, article_id))
            mapped_articles.add(article_id)

    mappings = [
        {
            "question_bank_id": bank_id,
            "article_id": article_id,
            "display_order": display_order_by_article[article_id],
        }
        for bank_id, article_id in sorted(mapping_keys, key=lambda item: (item[0], display_order_by_article[item[1]]))
    ]
    return mappings, mapped_articles


def ingest_library_db(
    client: SupabaseIngestClient,
    db_path: str,
    *,
    table_name: str | None,
    source: str,
    strict_validation: bool,
    batch_size: int,
    query_batch_size: int,
    pause: float,
) -> None:
    resolved_table, rows = load_library_db_rows(db_path, table_name)
    print(
        f"[LIBRARY] Loaded {len(rows)} source rows from {db_path} "
        f"(table: {resolved_table})."
    )

    articles, article_by_main_id = prepare_library_articles(rows, source=source)
    print(
        f"[LIBRARY] Deduplicated to {len(articles)} articles across "
        f"{len(article_by_main_id)} unique main_id values."
    )

    main_ids = sorted(article_by_main_id)
    production_questions = fetch_production_questions(
        client,
        main_ids,
        query_batch_size=query_batch_size,
    )
    validate_library_rows(
        rows,
        production_questions,
        strict=strict_validation,
    )
    print(f"[LIBRARY] Matched {len(production_questions)}/{len(main_ids)} main_id values in Production.")

    question_ids = sorted({int(row["id"]) for row in production_questions.values()})
    memberships = fetch_question_bank_memberships(
        client,
        question_ids,
        query_batch_size=query_batch_size,
    )
    mappings, mapped_articles = build_library_bank_mappings(
        articles=articles,
        article_by_main_id=article_by_main_id,
        production_questions=production_questions,
        memberships_by_question_id=memberships,
    )

    uploaded_articles = upload_records(
        client,
        "library_articles",
        articles,
        batch_size=batch_size,
        pause=pause,
        on_conflict="id",
    )
    uploaded_mappings = upload_records(
        client,
        "question_bank_library_articles",
        mappings,
        batch_size=batch_size,
        pause=pause,
        on_conflict="question_bank_id,article_id",
    )

    unmapped_articles = {str(article["id"]) for article in articles} - mapped_articles
    if unmapped_articles:
        print(
            f"[WARN] {len(unmapped_articles)} uploaded articles have no question-bank mapping. "
            "They will not be visible in a bank library until mapped."
        )

    print(
        f"[LIBRARY] Complete: {uploaded_articles} articles, "
        f"{uploaded_mappings} bank mappings."
    )


def ingest_library_json(
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
    if not all(isinstance(article, dict) for article in articles):
        raise RuntimeError("library_articles.json must contain only JSON objects.")

    print(
        "[LIBRARY] No SQLite DB found; using legacy library_articles.json. "
        "Legacy JSON mode does not infer question-bank mappings."
    )
    uploaded = upload_records(
        client,
        "library_articles",
        articles,
        batch_size=batch_size,
        pause=pause,
        on_conflict="id",
    )
    print(f"[LIBRARY] Uploaded {uploaded}/{len(articles)} legacy articles.")


def ingest_library(
    client: SupabaseIngestClient,
    data_dir: str,
    *,
    db_path: str | None,
    table_name: str | None,
    source: str,
    strict_validation: bool,
    batch_size: int,
    query_batch_size: int,
    pause: float,
) -> None:
    resolved_db = discover_library_db(data_dir, db_path)
    if resolved_db:
        ingest_library_db(
            client,
            resolved_db,
            table_name=table_name,
            source=source,
            strict_validation=strict_validation,
            batch_size=batch_size,
            query_batch_size=query_batch_size,
            pause=pause,
        )
        return
    ingest_library_json(client, data_dir, batch_size=batch_size, pause=pause)


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
        ingest_library(
            client,
            data_dir,
            db_path=args.library_db,
            table_name=args.library_table,
            source=args.library_source,
            strict_validation=args.strict_library_validation,
            batch_size=args.library_batch,
            query_batch_size=args.library_query_batch,
            pause=args.pause,
        )
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
