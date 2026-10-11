import importlib.util
import os
from pathlib import Path
import sqlite3


spec = importlib.util.spec_from_file_location("orphan_sweep", Path(__file__).parents[1] / "scripts/sweep_orphan_media.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def setup(tmp_path):
    db_path = tmp_path / "data.db"
    with sqlite3.connect(db_path) as db:
        db.execute("create table jobs (status text, request_json text)")
        db.execute("create table arbitrary_references (value text)")
    media = tmp_path / "media"
    media.mkdir()
    return db_path, media


def media_file(media, name, *, old=True):
    path = media / name
    path.write_bytes(b"file")
    os.utime(path, (100 if old else 100000, 100 if old else 100000))
    return path


def test_protects_all_reference_columns_and_recent_or_unknown_files(tmp_path):
    db, media = setup(tmp_path)
    reference = media_file(media, "aaaaaaaaaaaa_1.png")
    job_reference = media_file(media, "bbbbbbbbbbbb_1.wav")
    orphan = media_file(media, "cccccccccccc_1.png")
    recent = media_file(media, "dddddddddddd_1.png", old=False)
    unknown = media_file(media, "manual-original.png")
    with sqlite3.connect(db) as conn:
        conn.execute("insert into arbitrary_references values (?)", ('{"image":"https://example.test/media/' + reference.name + '?x=1"}',))
        conn.execute("insert into jobs values ('succeeded', ?)", ('{"audio_key":"/media/' + job_reference.name + '"}',))
    result = module.sweep(db, media, now=100001)
    assert result == {"deleted_files": 1, "deleted_bytes": 4}
    assert not orphan.exists()
    assert all(path.exists() for path in (reference, job_reference, recent, unknown))


def test_active_jobs_block_sweep_and_release_database_lock(tmp_path):
    db, media = setup(tmp_path)
    orphan = media_file(media, "aaaaaaaaaaaa_1.png")
    with sqlite3.connect(db) as conn:
        conn.execute("insert into jobs values ('running', '{}')")
    assert module.sweep(db, media, now=100001)["skipped"] == "active_jobs"
    assert orphan.exists()
    with sqlite3.connect(db, timeout=0) as conn:
        conn.execute("update jobs set status='succeeded'")
    assert module.sweep(db, media, now=100001)["deleted_files"] == 1


def test_batch_limit_and_busy_database_preserve_files(tmp_path):
    db, media = setup(tmp_path)
    first = media_file(media, "aaaaaaaaaaaa_1.png")
    second = media_file(media, "bbbbbbbbbbbb_1.png")
    with sqlite3.connect(db) as locked:
        locked.execute("BEGIN IMMEDIATE")
        try:
            module.sweep(db, media, now=100001)
        except sqlite3.OperationalError:
            pass
        else:
            raise AssertionError("A busy database must not permit deletion")
        assert first.exists() and second.exists()
    assert module.sweep(db, media, now=100001, limit=1)["deleted_files"] == 1
    assert sum(path.exists() for path in (first, second)) == 1
