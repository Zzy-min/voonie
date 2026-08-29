import asyncio
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, DiaryArtifact, DiaryEntry, Job, Panel, User
from voonie.backend.app.models.schemas import ComicPanel, EmotionSummary, Storyboard
from voonie.backend.app.services.comic_composer import ComicComposer
from voonie.backend.app.services.storage_service import StorageService
from voonie.backend.app.workers.cleanup import cleanup_expired_media


def data_dir() -> Path:
    path = Path("voonie/backend/.pytest-data") / f"storage-{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    return path


def test_storage_url_uses_configured_public_base():
    tmp_path = data_dir()
    storage = StorageService(Settings(TEMP_MEDIA_DIR=tmp_path, MEDIA_PUBLIC_BASE="https://media.example.test/root/"))
    media = storage.save_bytes(b"image", suffix=".png")

    assert storage.get_file_url(media) == f"https://media.example.test/root/media/{media.name}"
    shutil.rmtree(tmp_path)


def test_composite_filename_uses_job_id():
    tmp_path = data_dir()
    storage = StorageService(Settings(TEMP_MEDIA_DIR=tmp_path))
    composer = ComicComposer(storage=storage)
    panel_path = tmp_path / "panel.png"
    Image.new("RGB", (8, 8), "white").save(panel_path)
    storyboard = Storyboard(
        title="不应进入文件名",
        emotion=EmotionSummary(
            primary_emotion="calm",
            emotion_label_zh="平静",
            mood_score=7,
            analysis="ok",
        ),
        panels=[ComicPanel(panel_id=index, scene_desc="scene", character_action="pose") for index in range(1, 5)],
        companion_note="ok",
    )

    output = composer.compose_4panel_strip(storyboard, [panel_path], output_id="job-123")

    assert output.name == "comic_strip_job-123.png"
    shutil.rmtree(tmp_path)


def test_storage_sweep_removes_unreferenced_expired_files():
    tmp_path = data_dir()
    storage = StorageService(Settings(TEMP_MEDIA_DIR=tmp_path, TEMP_FILE_TTL_HOURS=1))
    orphan = storage.save_bytes(b"orphan", suffix=".png")
    fresh = storage.save_bytes(b"fresh", suffix=".png")
    old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=2)).timestamp()
    os.utime(orphan, (old_timestamp, old_timestamp))

    assert storage.cleanup_expired_files() == 1
    assert not orphan.exists()
    assert fresh.exists()
    shutil.rmtree(tmp_path)


def test_storage_sweep_preserves_referenced_expired_files():
    tmp_path = data_dir()
    storage = StorageService(Settings(TEMP_MEDIA_DIR=tmp_path, TEMP_FILE_TTL_HOURS=1))
    referenced = storage.save_bytes(b"referenced", suffix=".png")
    old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=2)).timestamp()
    os.utime(referenced, (old_timestamp, old_timestamp))

    assert storage.cleanup_expired_files({str(referenced)}) == 0
    assert referenced.exists()
    shutil.rmtree(tmp_path)


def test_cleanup_removes_expired_artifact_and_audio_files():
    tmp_path = data_dir()
    async def scenario():
        database_path = tmp_path / "cleanup.db"
        engine = create_async_engine(f"sqlite+aiosqlite:///{database_path.as_posix()}")
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        storage = StorageService(Settings(TEMP_MEDIA_DIR=tmp_path / "media"))
        expired_composite = storage.save_bytes(b"composite", suffix=".png")
        expired_panel = storage.save_bytes(b"panel", suffix=".png")
        expired_audio = storage.save_bytes(b"audio", suffix=".wav")
        fresh_file = storage.save_bytes(b"fresh", suffix=".png")
        old_timestamp = (datetime.now(timezone.utc) - timedelta(hours=2)).timestamp()
        os.utime(expired_composite, (old_timestamp, old_timestamp))

        async with factory() as session:
            user = User(device_id="cleanup-user")
            session.add(user)
            await session.flush()
            job = Job(user_id=user.id, type="comic", request_json={"audio_key": str(expired_audio)})
            session.add(job)
            await session.flush()
            entry = DiaryEntry(
                user_id=user.id,
                local_id="cleanup-entry",
                entry_date=datetime.now(timezone.utc),
                timezone="UTC",
                input_type="voice",
                redacted_text="done",
                audio_key=str(expired_audio),
                audio_delete_after=datetime.now(timezone.utc) - timedelta(minutes=1),
            )
            session.add(entry)
            artifact = DiaryArtifact(
                user_id=user.id,
                job_id=job.id,
                artifact_type="instant_comic",
                title="expired",
                emotion_label="calm",
                mood_score=7,
                companion_note="note",
                composite_key=str(expired_composite),
                panel_keys_json=[str(expired_panel)],
                expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            )
            session.add(artifact)
            await session.flush()
            session.add(Panel(artifact_id=artifact.id, panel_no=1, storyboard_json={}, image_key=str(expired_panel)))
            await session.commit()

        result = await cleanup_expired_media(factory, storage, now=datetime.now(timezone.utc))

        assert result.deleted_files == 3
        assert not expired_composite.exists()
        assert not expired_panel.exists()
        assert not expired_audio.exists()
        assert fresh_file.exists()
        async with factory() as session:
            stored_entry = await session.get(DiaryEntry, entry.id)
            stored_job = await session.get(Job, job.id)
            stored_artifact = await session.get(DiaryArtifact, artifact.id)
            assert stored_entry.audio_key is None
            assert "audio_key" not in stored_job.request_json
            assert stored_artifact.composite_key is None
        await engine.dispose()

    asyncio.run(scenario())
    shutil.rmtree(tmp_path)
