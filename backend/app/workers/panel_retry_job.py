from datetime import datetime, timezone
from pathlib import Path
import asyncio

from sqlalchemy import select, update

from voonie.backend.app.db.models import DiaryArtifact, Job, Panel
from voonie.backend.app.models.schemas import CharacterConfig, ComicPanel, Storyboard
from voonie.backend.app.workers.comic_job import update_job


async def execute_panel_retry_job(context: dict, job_id: str) -> None:
    session_factory = context["session_factory"]
    async with session_factory() as session:
        claimed = await session.execute(
            update(Job).where(Job.id == job_id, Job.status == "queued")
            .values(status="running", stage="rendering", progress=0.3)
        )
        await session.commit()
        if claimed.rowcount != 1:
            return
        job = await session.get(Job, job_id)
        request_data = dict(job.request_json)
        artifact = await session.get(DiaryArtifact, request_data["artifact_id"])
        panel = await session.scalar(
            select(Panel).where(
                Panel.artifact_id == request_data["artifact_id"],
                Panel.panel_no == request_data["panel_no"],
            )
        )
        if artifact is None or panel is None:
            job.status = "failed"
            job.stage = "failed"
            job.error = "artifact_or_panel_missing"
            job.finished_at = datetime.now(timezone.utc)
            await session.commit()
            return
        storyboard_panel = ComicPanel.model_validate(panel.storyboard_json)
        snapshot = artifact.character_snapshot_json or {}
        character = CharacterConfig(
            character_name=snapshot.get("character_name", "我"),
            appearance_prompt=snapshot.get("appearance_prompt", CharacterConfig().appearance_prompt),
            style_preset=snapshot.get("style_preset", "chibi_manga"),
        )

    try:
        image_path, prompt = await context["image_service"].generate_panel_image(
            storyboard_panel,
            character,
            None,
        )
        storyboard_panel.image_url = context["storage"].get_file_url(image_path)
        async with session_factory() as session:
            completed = await session.execute(
                update(Job).where(Job.id == job_id, Job.status == "running")
                .values(status="done", stage="done", progress=1.0, finished_at=datetime.now(timezone.utc))
            )
            if completed.rowcount != 1:
                await session.rollback()
                context["storage"].delete(image_path)
                return
            artifact = await session.get(DiaryArtifact, request_data["artifact_id"])
            panels = (await session.scalars(
                select(Panel).where(Panel.artifact_id == artifact.id).order_by(Panel.panel_no)
            )).all()
            target = next(item for item in panels if item.panel_no == request_data["panel_no"])
            target.image_key = str(image_path)
            target.prompt_snapshot = prompt
            target.status = "completed"
            target.retry_count += 1
            target.storyboard_json = storyboard_panel.model_dump(mode="json")
            rebuilt_panels = [ComicPanel.model_validate(item.storyboard_json) for item in panels]
            if len(rebuilt_panels) < 4:
                rebuilt_panels.extend(rebuilt_panels[: 4 - len(rebuilt_panels)])
            storyboard = Storyboard(
                title=artifact.title,
                emotion={
                    "primary_emotion": artifact.emotion_label,
                    "emotion_label_zh": artifact.emotion_label,
                    "mood_score": artifact.mood_score,
                    "analysis": artifact.companion_note,
                },
                panels=rebuilt_panels[:4],
                companion_note=artifact.companion_note,
            )
            panel_paths = [Path(item.image_key) for item in panels][:4]
            composite_path = await asyncio.to_thread(
        context["composer"].compose_4panel_strip, storyboard, panel_paths, job_id
            )
            artifact.composite_key = str(composite_path)
            artifact.panel_keys_json = [str(path) for path in panel_paths]
            job = await session.get(Job, job_id)
            job.result_json = {
                "artifact_id": artifact.id,
                "panel_no": target.panel_no,
                "image_url": context["storage"].get_file_url(image_path),
                "composite_comic_url": context["storage"].get_file_url(composite_path),
            }
            await session.commit()
    except Exception as exc:
        await update_job(
            session_factory,
            job_id,
            status="failed",
            stage="failed",
            progress=0.0,
            error=f"{type(exc).__name__}: {exc}",
            finished=True,
        )
        raise
