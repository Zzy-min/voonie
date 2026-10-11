from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from voonie.backend.app.db.models import Character, CharacterReference, DailyDiary, DiaryArtifact, DiaryEntry, DiaryReference, Feedback, Job, Panel
from voonie.backend.app.services.storage_service import StorageService


@dataclass(frozen=True)
class CleanupResult:
    deleted_files: int = 0


async def cleanup_expired_media(
    session_factory,
    storage: StorageService,
    *,
    now: datetime | None = None,
) -> CleanupResult:
    cutoff = now or datetime.now(timezone.utc)
    deleted = 0
    async with session_factory() as session:
        artifacts = list((await session.scalars(select(DiaryArtifact).where(
            DiaryArtifact.expires_at.is_not(None),
            DiaryArtifact.expires_at <= cutoff,
        ))).all())
        for artifact in artifacts:
            for key in [artifact.composite_key, *artifact.panel_keys_json]:
                deleted += int(storage.delete(key))
            panels = list((await session.scalars(select(Panel).where(Panel.artifact_id == artifact.id))).all())
            for panel in panels:
                deleted += int(storage.delete(panel.image_key))
                panel.image_key = None
            artifact.composite_key = None
            artifact.panel_keys_json = []

        entries = list((await session.scalars(select(DiaryEntry).where(
            DiaryEntry.audio_key.is_not(None),
            DiaryEntry.audio_delete_after.is_not(None),
            DiaryEntry.audio_delete_after <= cutoff,
        ))).all())
        removed_audio_keys: set[str] = set()
        for entry in entries:
            if entry.audio_key:
                removed_audio_keys.add(entry.audio_key)
                deleted += int(storage.delete(entry.audio_key))
            entry.audio_key = None
            entry.audio_delete_after = None

        jobs = list((await session.scalars(select(Job))).all())
        for job in jobs:
            request_data = dict(job.request_json or {})
            if request_data.get("audio_key") in removed_audio_keys:
                request_data.pop("audio_key", None)
                job.request_json = request_data

        await session.commit()
    return CleanupResult(deleted_files=deleted)


async def cleanup_cron(context: dict) -> None:
    # Expired audio can still be an input to an active task. Check before any deletion.
    async with context["session_factory"]() as session:
        active = await session.scalar(select(Job.id).where(Job.status.in_(["queued", "running"])).limit(1))
        if active:
            return
    await cleanup_expired_media(context["session_factory"], context["storage"])
    async with context["session_factory"]() as session:
        artifacts = list((await session.scalars(select(DiaryArtifact))).all())
        panels = list((await session.scalars(select(Panel))).all())
        entries = list((await session.scalars(select(DiaryEntry))).all())
        character_keys = (await session.scalars(select(CharacterReference.media_key))).all()
        diary_reference_keys = (await session.scalars(select(DiaryReference.media_key))).all()
        character_covers = (await session.scalars(select(Character.reference_image_key))).all()
        daily_diaries = (await session.scalars(select(DailyDiary))).all()
        feedback_keys = (await session.scalars(select(Feedback.attachment_key))).all()
        active_jobs = (await session.scalars(select(Job).where(Job.status.in_(["queued", "running"])))).all()
        referenced = {
            key for artifact in artifacts
            for key in [artifact.composite_key, *(artifact.panel_keys_json or [])]
            if key
        }
        referenced.update(panel.image_key for panel in panels if panel.image_key)
        referenced.update(entry.audio_key for entry in entries if entry.audio_key)
        referenced.update(key for key in [*character_keys, *diary_reference_keys, *character_covers, *feedback_keys] if key)
        referenced.update(key for diary in daily_diaries for key in [diary.cover_key, diary.composite_key] if key)
        # Long-running generation can create files before the final database commit.
        # Hold the sweep while a job is active rather than guessing its intermediate paths.
        if active_jobs:
            return
    context["storage"].cleanup_expired_files(referenced)
