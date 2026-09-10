#!/usr/bin/env python3
"""Build temporary statement-safe SQL chunks for bootstrapping a fresh DEV database.

This is setup tooling only. It never changes migration source files. The generated
chunks are derived from supabase/migrations in lexical order and are intentionally
small enough to be applied through the Supabase management connector.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path

import sqlparse

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"
OUTPUT_DIR = ROOT / "supabase" / "dev_bootstrap_chunks"
MAX_CHARS = 18_000

TX_CONTROL = re.compile(r"^(?:BEGIN|START\s+TRANSACTION|COMMIT|END\s+TRANSACTION)\s*;?$", re.I)


def normalized_statements(text: str) -> list[str]:
    statements: list[str] = []
    for statement in sqlparse.split(text):
        statement = statement.strip()
        if not statement:
            continue
        # apply_migration already provides transaction handling. Keeping outer
        # BEGIN/COMMIT statements would make it impossible to split a large file.
        if TX_CONTROL.fullmatch(statement):
            continue
        statements.append(statement.rstrip(";") + ";")
    return statements


def main() -> None:
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        raise SystemExit("No migration files found")

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    chunks: list[dict[str, object]] = []
    current_parts: list[str] = []
    current_sources: list[str] = []
    current_size = 0
    largest_statement = 0

    def flush() -> None:
        nonlocal current_parts, current_sources, current_size
        if not current_parts:
            return
        index = len(chunks) + 1
        filename = f"{index:03d}_bootstrap.sql"
        body = "\n\n".join(current_parts).rstrip() + "\n"
        (OUTPUT_DIR / filename).write_text(body, encoding="utf-8")
        chunks.append(
            {
                "index": index,
                "file": filename,
                "bytes": len(body.encode("utf-8")),
                "chars": len(body),
                "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                "sources": list(dict.fromkeys(current_sources)),
            }
        )
        current_parts = []
        current_sources = []
        current_size = 0

    for migration in migration_files:
        text = migration.read_text(encoding="utf-8")
        statements = normalized_statements(text)
        if not statements:
            continue
        for statement in statements:
            largest_statement = max(largest_statement, len(statement))
            separator = 2 if current_parts else 0
            projected = current_size + separator + len(statement)
            if current_parts and projected > MAX_CHARS:
                flush()
            current_parts.append(statement)
            current_sources.append(migration.name)
            current_size += (2 if len(current_parts) > 1 else 0) + len(statement)
    flush()

    manifest = {
        "generated_from": [p.name for p in migration_files],
        "chunk_count": len(chunks),
        "max_chars_target": MAX_CHARS,
        "largest_statement_chars": largest_statement,
        "chunks": chunks,
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(json.dumps({"chunk_count": len(chunks), "largest_statement_chars": largest_statement}))


if __name__ == "__main__":
    main()
