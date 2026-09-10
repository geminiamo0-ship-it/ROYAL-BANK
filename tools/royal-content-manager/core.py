from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import httpx

QUESTION_FIELDS = [
    "id", "main_id", "text_html", "explanation_html", "category", "topic",
    "concept", "concept_id", "notes_id", "difficulty", "source",
    "pm_question_id", "concepts_json",
]
QUESTION_REQUIRED = {"id", "text_html", "explanation_html", "category"}
OPTION_FIELDS = ["question_id", "text_html", "is_correct", "option_order", "percentage"]
OPTION_REQUIRED = {"question_id", "text_html", "is_correct", "option_order"}
ARTICLE_FIELDS = ["id", "name", "category", "content_html", "source"]
ARTICLE_REQUIRED = {"id", "name", "content_html"}

ALIASES: dict[str, list[str]] = {
    "id": ["id", "question_id", "qid"],
    "main_id": ["main_id", "mainid", "mainId"],
    "text_html": ["text_html", "question_html", "question_text", "text", "stem_html", "stem", "option_html", "option_text"],
    "explanation_html": ["explanation_html", "explanation", "rationale_html", "rationale", "answer_explanation"],
    "category": ["category", "subject", "system", "specialty"],
    "topic": ["topic", "subtopic"],
    "concept": ["concept"],
    "concept_id": ["concept_id", "conceptid"],
    "notes_id": ["notes_id", "notesid"],
    "difficulty": ["difficulty", "level"],
    "source": ["source", "provider"],
    "pm_question_id": ["pm_question_id", "passmedicine_id", "pm_id"],
    "concepts_json": ["concepts_json", "concept_json", "concepts"],
    "question_id": ["question_id", "questionid", "qid", "parent_question_id"],
    "is_correct": ["is_correct", "correct", "is_answer", "answer", "correct_answer"],
    "option_order": ["option_order", "sort_order", "position", "order_index", "display_order"],
    "percentage": ["percentage", "percent", "pct", "answer_percentage"],
    "name": ["name", "title", "article_name"],
    "content_html": ["content_html", "html", "content", "body_html", "body"],
}


def clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text != "" else None


def parse_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y", "correct"}


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def fingerprint(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return value.strip("-") or "pathway"


@dataclass
class Issue:
    severity: str
    code: str
    message: str


@dataclass
class SchemaMapping:
    question_table: str = ""
    option_table: str = ""
    article_table: str = ""
    question: dict[str, str | None] = field(default_factory=dict)
    option: dict[str, str | None] = field(default_factory=dict)
    article: dict[str, str | None] = field(default_factory=dict)


@dataclass
class SourceData:
    questions: list[dict[str, Any]]
    options: list[dict[str, Any]]
    articles: list[dict[str, Any]]

    @property
    def options_by_question(self) -> dict[int, list[dict[str, Any]]]:
        grouped: dict[int, list[dict[str, Any]]] = {}
        for option in self.options:
            grouped.setdefault(int(option["question_id"]), []).append(option)
        for rows in grouped.values():
            rows.sort(key=lambda row: int(row["option_order"]))
        return grouped


@dataclass
class PreviewResult:
    questions_insert: int = 0
    questions_update: int = 0
    questions_unchanged: int = 0
    questions_target_only_untouched: int = 0
    question_mappings_add: int = 0
    articles_insert: int = 0
    articles_update: int = 0
    articles_unchanged: int = 0
    articles_target_only_untouched: int = 0
    article_mappings_add: int = 0

    def rows(self) -> list[tuple[str, int, str]]:
        return [
            ("Questions to insert", self.questions_insert, "Will be created"),
            ("Questions to update", self.questions_update, "Same ID; current content/options change"),
            ("Questions unchanged", self.questions_unchanged, "No content change"),
            ("Target questions absent from source", self.questions_target_only_untouched, "LEFT COMPLETELY UNTOUCHED"),
            ("Question-bank mappings to add", self.question_mappings_add, "Source questions will be mapped to the bank"),
            ("Articles to insert", self.articles_insert, "Will be created"),
            ("Articles to update", self.articles_update, "Same ID; current content changes"),
            ("Articles unchanged", self.articles_unchanged, "No content change"),
            ("Target articles absent from source", self.articles_target_only_untouched, "LEFT COMPLETELY UNTOUCHED"),
            ("Article-bank mappings to add", self.article_mappings_add, "Source articles will be mapped to the bank"),
        ]


class SQLiteSource:
    def __init__(self, path: str):
        self.path = path

    def connect(self) -> sqlite3.Connection:
        uri = Path(self.path).resolve().as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True)
        connection.row_factory = sqlite3.Row
        return connection

    def tables(self) -> dict[str, list[str]]:
        with self.connect() as connection:
            names = [
                row["name"]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
            ]
            return {
                table: [row["name"] for row in connection.execute(f"PRAGMA table_info({quote_ident(table)})")]
                for table in names
            }

    @staticmethod
    def best_column(columns: list[str], field: str) -> str | None:
        by_lower = {column.lower(): column for column in columns}
        for alias in ALIASES.get(field, [field]):
            if alias.lower() in by_lower:
                return by_lower[alias.lower()]
        return None

    @classmethod
    def auto_mapping(cls, tables: dict[str, list[str]]) -> SchemaMapping:
        if not tables:
            return SchemaMapping()

        def score(table: str, fields: Iterable[str]) -> int:
            return sum(1 for field in fields if cls.best_column(tables[table], field))

        q_table = max(tables, key=lambda table: score(table, QUESTION_REQUIRED | {"main_id", "topic"}))
        option_candidates = [table for table in tables if table != q_table]
        o_table = max(option_candidates, key=lambda table: score(table, OPTION_REQUIRED | {"percentage"}), default="")
        article_candidates = [table for table in tables if table not in {q_table, o_table}]
        a_table = max(article_candidates, key=lambda table: score(table, ARTICLE_REQUIRED | {"category"}), default="")
        if a_table and score(a_table, ARTICLE_REQUIRED) < len(ARTICLE_REQUIRED):
            a_table = ""

        mapping = SchemaMapping(q_table, o_table, a_table)
        mapping.question = {field: cls.best_column(tables.get(q_table, []), field) for field in QUESTION_FIELDS}
        mapping.option = {field: cls.best_column(tables.get(o_table, []), field) for field in OPTION_FIELDS}
        mapping.article = {field: cls.best_column(tables.get(a_table, []), field) for field in ARTICLE_FIELDS}
        return mapping

    def _read(self, table: str, mapping: dict[str, str | None]) -> list[dict[str, Any]]:
        selected = [(canonical, source) for canonical, source in mapping.items() if source]
        if not table or not selected:
            return []
        projection = ", ".join(f"{quote_ident(source)} AS {quote_ident(canonical)}" for canonical, source in selected)
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(f"SELECT {projection} FROM {quote_ident(table)}")]

    def load(self, mapping: SchemaMapping) -> SourceData:
        question_rows = self._read(mapping.question_table, mapping.question)
        option_rows = self._read(mapping.option_table, mapping.option)
        article_rows = self._read(mapping.article_table, mapping.article) if mapping.article_table else []

        questions: list[dict[str, Any]] = []
        for row in question_rows:
            question = {field: row.get(field) for field in QUESTION_FIELDS}
            question["id"] = int(question["id"]) if question.get("id") is not None else None
            question["main_id"] = int(question["main_id"]) if question.get("main_id") not in (None, "") else None
            for field in ["text_html", "explanation_html", "category", "topic", "concept", "concept_id", "notes_id", "difficulty", "source", "pm_question_id", "concepts_json"]:
                question[field] = clean_text(question.get(field))
            questions.append(question)

        options: list[dict[str, Any]] = []
        for row in option_rows:
            percentage = row.get("percentage")
            if percentage not in (None, ""):
                try:
                    percentage = float(percentage)
                except (TypeError, ValueError):
                    pass
            else:
                percentage = None
            options.append({
                "question_id": int(row["question_id"]) if row.get("question_id") is not None else None,
                "text_html": clean_text(row.get("text_html")),
                "is_correct": parse_bool(row.get("is_correct")),
                "option_order": int(row["option_order"]) if row.get("option_order") not in (None, "") else None,
                "percentage": percentage,
            })

        articles = [
            {
                "id": clean_text(row.get("id")),
                "name": clean_text(row.get("name")),
                "category": clean_text(row.get("category")),
                "content_html": clean_text(row.get("content_html")),
                "source": clean_text(row.get("source")),
                "display_order": index,
            }
            for index, row in enumerate(article_rows)
        ]
        return SourceData(questions, options, articles)


def validate_mapping(mapping: SchemaMapping) -> list[Issue]:
    issues: list[Issue] = []
    if not mapping.question_table:
        issues.append(Issue("ERROR", "QUESTION_TABLE", "Question table is not selected."))
    if not mapping.option_table:
        issues.append(Issue("ERROR", "OPTION_TABLE", "Option table is not selected."))
    for field in sorted(QUESTION_REQUIRED):
        if not mapping.question.get(field):
            issues.append(Issue("ERROR", "QUESTION_COLUMN", f"Required question column is not mapped: {field}"))
    for field in sorted(OPTION_REQUIRED):
        if not mapping.option.get(field):
            issues.append(Issue("ERROR", "OPTION_COLUMN", f"Required option column is not mapped: {field}"))
    if mapping.article_table:
        for field in sorted(ARTICLE_REQUIRED):
            if not mapping.article.get(field):
                issues.append(Issue("ERROR", "ARTICLE_COLUMN", f"Required article column is not mapped: {field}"))
    return issues


def validate_source(data: SourceData) -> list[Issue]:
    issues: list[Issue] = []
    if not data.questions:
        return [Issue("ERROR", "NO_QUESTIONS", "No questions were loaded from the source database.")]

    qids = [q.get("id") for q in data.questions]
    qid_set = {qid for qid in qids if qid is not None}
    duplicate_qids = sorted({qid for qid in qid_set if qids.count(qid) > 1})
    if duplicate_qids:
        issues.append(Issue("ERROR", "DUPLICATE_QUESTION_ID", f"Duplicate question IDs: {duplicate_qids[:20]}"))

    main_ids = [q.get("main_id") for q in data.questions if q.get("main_id") is not None]
    duplicate_main = sorted({mid for mid in set(main_ids) if main_ids.count(mid) > 1})
    if duplicate_main:
        issues.append(Issue("ERROR", "DUPLICATE_MAIN_ID", f"Duplicate main_id values: {duplicate_main[:20]}"))

    empty_questions = [q.get("id") for q in data.questions if not q.get("text_html") or not q.get("explanation_html") or not q.get("category")]
    if empty_questions:
        issues.append(Issue("ERROR", "EMPTY_REQUIRED_QUESTION_FIELD", f"Questions with empty text/explanation/category: {empty_questions[:20]}"))

    grouped: dict[int, list[dict[str, Any]]] = {}
    orphan: set[int] = set()
    for option in data.options:
        qid = option.get("question_id")
        if qid is None:
            continue
        qid = int(qid)
        if qid not in qid_set:
            orphan.add(qid)
        grouped.setdefault(qid, []).append(option)

    missing_options = sorted(qid_set - set(grouped))
    if missing_options:
        issues.append(Issue("ERROR", "QUESTION_WITHOUT_OPTIONS", f"Questions with no options: {missing_options[:20]}"))
    if orphan:
        issues.append(Issue("ERROR", "ORPHAN_OPTIONS", f"Options reference missing questions: {sorted(orphan)[:20]}"))

    bad_correct: list[tuple[int, int]] = []
    bad_order: list[int] = []
    empty_option: list[int] = []
    bad_percentage: list[int] = []
    for qid, options in grouped.items():
        correct_count = sum(1 for option in options if option.get("is_correct"))
        if correct_count != 1:
            bad_correct.append((qid, correct_count))
        orders = [option.get("option_order") for option in options]
        if None in orders or len(set(orders)) != len(orders):
            bad_order.append(qid)
        if any(not option.get("text_html") for option in options):
            empty_option.append(qid)
        for option in options:
            pct = option.get("percentage")
            if pct is not None and (not isinstance(pct, (int, float)) or pct < 0 or pct > 100):
                bad_percentage.append(qid)
                break

    if bad_correct:
        issues.append(Issue("ERROR", "CORRECT_OPTION_COUNT", f"Questions must have exactly one correct option. Examples: {bad_correct[:20]}"))
    if bad_order:
        issues.append(Issue("ERROR", "DUPLICATE_OPTION_ORDER", f"Duplicate/missing option_order: {bad_order[:20]}"))
    if empty_option:
        issues.append(Issue("ERROR", "EMPTY_OPTION_TEXT", f"Empty option text: {empty_option[:20]}"))
    if bad_percentage:
        issues.append(Issue("ERROR", "INVALID_PERCENTAGE", f"Option percentages outside 0..100: {bad_percentage[:20]}"))

    article_ids = [article.get("id") for article in data.articles]
    duplicate_articles = sorted({aid for aid in set(article_ids) if aid and article_ids.count(aid) > 1})
    if duplicate_articles:
        issues.append(Issue("ERROR", "DUPLICATE_ARTICLE_ID", f"Duplicate article IDs: {duplicate_articles[:20]}"))
    invalid_articles = [article.get("id") for article in data.articles if not article.get("id") or not article.get("name") or not article.get("content_html")]
    if invalid_articles:
        issues.append(Issue("ERROR", "INVALID_ARTICLE", f"Articles missing id/name/content: {invalid_articles[:20]}"))
    if not data.articles:
        issues.append(Issue("INFO", "NO_LIBRARY", "No Library content detected. Question import can continue."))
    return issues


class RoyalApi:
    def __init__(self, url: str, service_role_key: str):
        self.url = url.rstrip("/")
        self.client = httpx.Client(
            timeout=httpx.Timeout(60.0, connect=15.0),
            headers={
                "apikey": service_role_key.strip(),
                "Authorization": f"Bearer {service_role_key.strip()}",
                "Content-Type": "application/json",
            },
        )

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = self.client.request(method, self.url + path, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"{method} {path} failed ({response.status_code}): {response.text[:1500]}")
        return response

    def select(self, table: str, params: dict[str, str] | None = None, page_size: int = 1000) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        start = 0
        while True:
            response = self._request("GET", f"/rest/v1/{table}", params=params or {}, headers={"Range": f"{start}-{start + page_size - 1}"})
            rows = response.json()
            result.extend(rows)
            if len(rows) < page_size:
                return result
            start += page_size

    def insert(self, table: str, rows: dict[str, Any] | list[dict[str, Any]], returning: bool = True) -> list[dict[str, Any]]:
        response = self._request("POST", f"/rest/v1/{table}", json=rows, headers={"Prefer": "return=representation" if returning else "return=minimal"})
        return response.json() if returning and response.text else []

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        response = self._request("POST", f"/rest/v1/rpc/{name}", json=payload)
        return response.json() if response.text else None

    def health(self) -> None:
        self.select("pathways", {"select": "id", "limit": "1"})
        self.select("question_banks", {"select": "id", "limit": "1"})

    def pathways(self) -> list[dict[str, Any]]:
        return self.select("pathways", {"select": "id,name,slug,description,display_order", "order": "display_order.asc,id.asc"})

    def banks(self, pathway_id: int) -> list[dict[str, Any]]:
        return self.select("question_banks", {
            "select": "id,pathway_id,name,description,display_order,is_free_trial",
            "pathway_id": f"eq.{pathway_id}",
            "order": "display_order.asc,id.asc",
        })

    def create_pathway(self, name: str, description: str = "") -> dict[str, Any]:
        existing = {row["slug"] for row in self.pathways()}
        base = slugify(name)
        slug = base
        suffix = 2
        while slug in existing:
            slug = f"{base}-{suffix}"
            suffix += 1
        return self.insert("pathways", {
            "name": name.strip(), "slug": slug, "description": description.strip() or None,
            "is_free_trial_available": False, "display_order": 0,
        })[0]

    def create_bank(self, pathway_id: int, name: str, description: str = "") -> dict[str, Any]:
        return self.insert("question_banks", {
            "pathway_id": pathway_id, "name": name.strip(), "description": description.strip() or None,
            "display_order": 0, "is_free_trial": False, "free_trial_block_limit": None,
            "free_trial_question_limit": 70, "free_trial_article_limit": 10,
        })[0]

    def ensure_standard_plans(self, product_type: str, target_id: int) -> None:
        field = "pathway_id" if product_type == "pathway" else "question_bank_id"
        products = self.select("catalog_products", {"select": "id", "product_type": f"eq.{product_type}", field: f"eq.{target_id}", "limit": "1"})
        if not products:
            raise RuntimeError("Catalog product trigger did not create the expected product.")
        product_id = int(products[0]["id"])
        if self.select("catalog_plans", {"select": "id", "product_id": f"eq.{product_id}", "limit": "1"}):
            return
        definitions = [
            ("1 Month", 1, False, False, 10), ("3 Months", 3, False, False, 20),
            ("6 Months", 6, True, True, 30), ("12 Months", 12, False, False, 40),
            ("Lifetime", None, False, False, 50),
        ]
        self.insert("catalog_plans", [{
            "product_id": product_id, "name": name, "duration_months": months, "price": None,
            "currency": "EGP", "status": "active", "show_price": False,
            "is_default": is_default, "is_recommended": recommended, "display_order": order,
        } for name, months, is_default, recommended, order in definitions], returning=False)

    def _select_numeric_in(self, table: str, key: str, values: list[int], select: str, chunk_size: int = 100) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for start in range(0, len(values), chunk_size):
            group = values[start:start + chunk_size]
            rows.extend(self.select(table, {"select": select, key: f"in.({','.join(map(str, group))})"}))
        return rows

    def existing_questions(self, ids: list[int]) -> dict[int, dict[str, Any]]:
        return {int(row["id"]): row for row in self._select_numeric_in("questions", "id", ids, ",".join(QUESTION_FIELDS))}

    def existing_options(self, ids: list[int]) -> dict[int, list[dict[str, Any]]]:
        grouped: dict[int, list[dict[str, Any]]] = {}
        for row in self._select_numeric_in("options", "question_id", ids, "question_id,text_html,is_correct,option_order,percentage"):
            grouped.setdefault(int(row["question_id"]), []).append(row)
        for rows in grouped.values():
            rows.sort(key=lambda row: int(row["option_order"]))
        return grouped

    def existing_articles(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for article_id in ids:
            rows = self.select("library_articles", {"select": "id,name,category,content_html,source", "id": f"eq.{article_id}", "limit": "1"})
            if rows:
                result[str(rows[0]["id"])] = rows[0]
        return result

    def mapped_question_ids(self, bank_id: int) -> set[int]:
        return {int(row["question_id"]) for row in self.select("question_bank_questions", {"select": "question_id", "question_bank_id": f"eq.{bank_id}"})}

    def mapped_article_ids(self, bank_id: int) -> set[str]:
        return {str(row["article_id"]) for row in self.select("question_bank_library_articles", {"select": "article_id", "question_bank_id": f"eq.{bank_id}"})}


def normalize_question(row: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for field in QUESTION_FIELDS:
        value = row.get(field)
        if field in {"id", "main_id"} and value not in (None, ""):
            value = int(value)
        elif field not in {"id", "main_id"}:
            value = None if value in (None, "") else str(value)
        result[field] = value
    result["difficulty"] = result.get("difficulty") or "1"
    result["source"] = result.get("source") or "PassMedicine"
    return result


def normalize_option(row: dict[str, Any]) -> dict[str, Any]:
    pct = row.get("percentage")
    return {
        "question_id": int(row["question_id"]), "text_html": str(row.get("text_html") or ""),
        "is_correct": bool(row.get("is_correct")), "option_order": int(row["option_order"]),
        "percentage": None if pct in (None, "") else float(pct),
    }


def normalize_article(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]), "name": str(row.get("name") or ""),
        "category": None if row.get("category") in (None, "") else str(row.get("category")),
        "content_html": str(row.get("content_html") or ""), "source": str(row.get("source") or "Pastest"),
    }


def build_preview(api: RoyalApi, data: SourceData, bank_id: int | None) -> PreviewResult:
    result = PreviewResult()
    source_ids = [int(question["id"]) for question in data.questions]
    source_options = data.options_by_question
    existing_questions = api.existing_questions(source_ids)
    existing_options = api.existing_options(source_ids)

    for question in data.questions:
        qid = int(question["id"])
        if qid not in existing_questions:
            result.questions_insert += 1
            continue
        source_bundle = {"question": normalize_question(question), "options": [normalize_option(row) for row in source_options.get(qid, [])]}
        target_bundle = {"question": normalize_question(existing_questions[qid]), "options": [normalize_option(row) for row in existing_options.get(qid, [])]}
        if fingerprint(source_bundle) == fingerprint(target_bundle):
            result.questions_unchanged += 1
        else:
            result.questions_update += 1

    article_ids = [str(article["id"]) for article in data.articles]
    existing_articles = api.existing_articles(article_ids)
    for article in data.articles:
        article_id = str(article["id"])
        if article_id not in existing_articles:
            result.articles_insert += 1
        elif fingerprint(normalize_article(article)) == fingerprint(normalize_article(existing_articles[article_id])):
            result.articles_unchanged += 1
        else:
            result.articles_update += 1

    if bank_id is None:
        result.question_mappings_add = len(source_ids)
        result.article_mappings_add = len(article_ids)
    else:
        mapped_questions = api.mapped_question_ids(bank_id)
        mapped_articles = api.mapped_article_ids(bank_id)
        source_question_set = set(source_ids)
        source_article_set = set(article_ids)
        result.questions_target_only_untouched = len(mapped_questions - source_question_set)
        result.question_mappings_add = len(source_question_set - mapped_questions)
        result.articles_target_only_untouched = len(mapped_articles - source_article_set)
        result.article_mappings_add = len(source_article_set - mapped_articles)
    return result
