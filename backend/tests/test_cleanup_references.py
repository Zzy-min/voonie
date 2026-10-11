import asyncio
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, DiaryEntry, DiaryReference, Job, User
from voonie.backend.app.services.storage_service import StorageService
from voonie.backend.app.workers.cleanup import cleanup_cron


def test_orphan_sweep_keeps_reference_images_and_active_job_files(tmp_path):
    async def scenario():
        engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'cleanup.db').as_posix()}")
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        storage = StorageService(Settings(TEMP_MEDIA_DIR=tmp_path / "media", TEMP_FILE_TTL_HOURS=1))
        reference = storage.save_bytes(b"reference", suffix=".png")
        intermediate = storage.save_bytes(b"intermediate", suffix=".png")
        audio = storage.save_bytes(b"audio", suffix=".m4a")
        timestamp = (datetime.now(timezone.utc) - timedelta(hours=2)).timestamp()
        for path in (reference, intermediate):
            os.utime(path, (timestamp, timestamp))
        async with factory() as session:
            user = User(device_id="cleanup-reference-test")
            session.add(user)
            await session.flush()
            entry = DiaryEntry(user_id=user.id, local_id="draft", entry_date=datetime.now(timezone.utc), timezone="UTC", input_type="voice", redacted_text="test", audio_key=str(audio), audio_delete_after=datetime.now(timezone.utc) - timedelta(minutes=1))
            session.add(entry)
            await session.flush()
            session.add(DiaryReference(user_id=user.id, entry_id=entry.id, media_key=str(reference), width=10, height=10))
            job = Job(user_id=user.id, type="comic", status="running", request_json={})
            session.add(job)
            await session.commit()
            job_id = job.id
        context = {"session_factory": factory, "storage": storage}
        await cleanup_cron(context)
        assert reference.exists() and intermediate.exists()
        assert audio.exists()
        async with factory() as session:
            job = await session.get(Job, job_id)
            job.status = "succeeded"
            await session.commit()
        await cleanup_cron(context)
        assert reference.exists()
        assert not intermediate.exists()
        assert not audio.exists()
        await engine.dispose()
    asyncio.run(scenario())
