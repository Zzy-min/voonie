"""Remove old unreferenced generated media without requiring a queue worker."""
import argparse
import json
from pathlib import Path
import re
import sqlite3
import time


GENERATED_NAME = re.compile(r"^[a-f0-9]{12}_\d+\.(?:png|jpe?g|webp|gif|m4a|wav|mp3|aac|webm|ogg|opus)$", re.I)
FILE_TOKEN = re.compile(r"[A-Za-z0-9_.-]+\.[A-Za-z0-9]+")


def sweep(database: Path, media_dir: Path, *, now: float | None = None, limit: int = 200) -> dict:
    """Hold the database write lock while rechecking references and unlinking files."""
    if not database.is_file() or not media_dir.is_dir() or media_dir.is_symlink():
        raise ValueError("Existing database and media directory are required")
    if limit < 1 or limit > 200:
        raise ValueError("Cleanup batch must contain 1 to 200 files")
    cutoff = (time.time() if now is None else now) - 86400
    candidates = []
    for path in media_dir.iterdir():
        if GENERATED_NAME.fullmatch(path.name) and not path.is_symlink() and path.is_file():
            if path.stat().st_mtime < cutoff:
                candidates.append(path)
    deleted = 0
    deleted_bytes = 0
    with sqlite3.connect(database.resolve().as_uri() + "?mode=rw", uri=True, timeout=2) as db:
        # Prevent a concurrent API or worker from attaching an old file between the
        # reference check and deletion. New uploaded files remain inside the grace period.
        db.execute("BEGIN IMMEDIATE")
        try:
            if db.execute("select count(*) from jobs where status in ('queued','running')").fetchone()[0]:
                return {"deleted_files": 0, "deleted_bytes": 0, "skipped": "active_jobs"}
            referenced = set()
            for table, in db.execute("select name from sqlite_master where type='table'"):
                query = 'select * from "' + table.replace('"', '""') + '"'
                for row in db.execute(query):
                    for value in row:
                        if isinstance(value, str):
                            referenced.update(FILE_TOKEN.findall(value))
            for path in candidates:
                if deleted >= limit:
                    break
                if path.name in referenced or path.is_symlink():
                    continue
                if path.resolve().parent != media_dir.resolve():
                    raise ValueError("Candidate outside media directory")
                try:
                    stat = path.stat()
                    if not path.is_file() or stat.st_mtime >= cutoff:
                        continue
                    path.unlink()
                except FileNotFoundError:
                    continue
                deleted += 1
                deleted_bytes += stat.st_size
        finally:
            db.rollback()
    return {"deleted_files": deleted, "deleted_bytes": deleted_bytes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--media-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(sweep(args.database, args.media_dir)))
