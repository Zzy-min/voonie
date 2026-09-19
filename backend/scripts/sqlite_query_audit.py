"""Inspect SQLite indexes and query plans for the main diary access paths."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


QUERIES = {
    "entries_by_user_date": "SELECT * FROM diary_entries WHERE user_id = ? ORDER BY entry_date DESC LIMIT 20",
    "jobs_by_user_created": "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    "artifacts_by_user_created": "SELECT * FROM diary_artifacts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    "share_posts_latest": "SELECT * FROM share_posts WHERE is_public = 1 ORDER BY created_at DESC LIMIT 20",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    connection = sqlite3.connect(args.database)
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    indexes = [dict(zip(("name", "table", "sql"), row)) for row in connection.execute(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name"
    )]
    plans = {}
    for name, query in QUERIES.items():
        table = query.split("FROM ", 1)[1].split(" ", 1)[0]
        if table not in tables:
            plans[name] = {"skipped": f"missing table {table}"}
            continue
        params = ("00000000-0000-0000-0000-000000000001",) if "?" in query else ()
        rows = connection.execute(f"EXPLAIN QUERY PLAN {query}", params).fetchall()
        plans[name] = [{"id": row[0], "parent": row[1], "detail": row[3]} for row in rows]
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"indexes": indexes, "plans": plans}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Audited {len(plans)} query plans and {len(indexes)} indexes")


if __name__ == "__main__":
    main()
