import asyncio
from datetime import datetime, timezone
from sqlalchemy import update

from voonie.backend.app.db.models import DailyDiary, DiaryArtifact, Job, Panel
from voonie.backend.app.models.schemas import CharacterConfig, ComicPanel, EmotionSummary, Storyboard
from voonie.backend.app.schemas.daily import DailyStorybook
from voonie.backend.app.services.prompt_builder import character_snapshot
from voonie.backend.app.workers.comic_job import update_job


def page_count_for(entry_count: int) -> int:
    if entry_count <= 0:
        return 0
    if entry_count <= 3:
        return 4
    if entry_count <= 5:
        return 6
    return 8


async def _execute_storybook_job(context: dict, job_id: str) -> None:
    session_factory = context["session_factory"]
    async with session_factory() as session:
        claimed = await session.execute(
            update(Job).where(Job.id == job_id, Job.status == "queued")
            .values(status="running", stage="planning", progress=0.15)
        )
        await session.commit()
        if claimed.rowcount != 1:
            return
        job = await session.get(Job, job_id)
        request_data = dict(job.request_json)
        daily = await session.get(DailyDiary, request_data["daily_diary_id"])
        if daily is None or not daily.summary:
            job.status = "failed"
            job.stage = "failed"
            job.error = "summary_required"
            job.finished_at = datetime.now(timezone.utc)
            await session.commit()
            return
        character = CharacterConfig.model_validate(request_data.get("character", {}))
        page_count = request_data["page_count"]
        prompt = f"PAGE_COUNT={page_count}\n{daily.summary}"
        parsed = await context["storyboard_agent"].provider.complete_json(
            "你是成人私人日记的每日绘本分镜作家。只输出 DailyStorybook JSON。",
            prompt,
        )
        storybook = DailyStorybook.model_validate(parsed)
        if len(storybook.pages) != page_count:
            raise ValueError("storybook page count mismatch")
        summary_text = daily.summary
        emotion_label = (daily.emotion_arc_json or ["平静"])[0]
        daily_id = daily.id
        user_id = job.user_id

    if not await update_job(session_factory, job_id, status="running", stage="rendering", progress=0.35):
        return
    panels = [
        ComicPanel(
            panel_id=page.page_no,
            scene_desc=page.scene_desc,
            character_action=page.character_action,
            narration=page.narration,
            speech_bubble=page.speech_bubble,
            sfx=page.sfx,
            forbidden=page.forbidden,
        )
        for page in storybook.pages
    ]

    async def render_one(panel: ComicPanel):
        path, prompt_text = await context["image_service"].generate_panel_image(panel, character, None)
        panel.image_url = context["storage"].get_file_url(path)
        return panel.panel_id, path, prompt_text

    rendered = await asyncio.gather(*[render_one(panel) for panel in panels])
    rendered.sort(key=lambda item: item[0])
    panel_paths = [item[1] for item in rendered]
    prompts = {item[0]: item[2] for item in rendered}
    emotion = EmotionSummary(
        primary_emotion="healing",
        emotion_label_zh=emotion_label,
        mood_score=7,
        analysis=summary_text or storybook.summary,
    )
    board = Storyboard(title=storybook.title, emotion=emotion, panels=panels[:4], companion_note=storybook.summary)
    composite_path = await asyncio.to_thread(
        context["composer"].compose_4panel_strip, board, panel_paths[:4], job_id
    )
    async with session_factory() as session:
        job = await session.get(Job, job_id)
        completed = await session.execute(
            update(Job).where(Job.id == job_id, Job.status == "running")
            .values(status="done", stage="done", progress=1.0, finished_at=datetime.now(timezone.utc))
        )
        if completed.rowcount != 1:
            await session.rollback()
            for path in [*panel_paths, composite_path]:
                context["storage"].delete(path)
            async with session_factory() as reset_session:
                cancelled_daily = await reset_session.get(DailyDiary, daily_id)
                if cancelled_daily is not None and cancelled_daily.status == "generating":
                    cancelled_daily.status = "ready"
                    await reset_session.commit()
            return
        daily = await session.get(DailyDiary, daily_id)
        daily.generation_version += 1
        daily.status = "completed"
        daily.title = storybook.title
        daily.cover_key = str(panel_paths[0])
        daily.composite_key = str(composite_path)
        artifact = DiaryArtifact(
            user_id=user_id,
            job_id=job.id,
            artifact_type="daily_storybook",
            version=daily.generation_version,
            title=storybook.title,
            emotion_label=emotion.emotion_label_zh,
            mood_score=emotion.mood_score,
            transcript_redacted=summary_text,
            companion_note=storybook.summary,
            composite_key=str(composite_path),
            panel_keys_json=[str(path) for path in panel_paths],
            character_snapshot_json=character_snapshot(character),
            daily_diary_id=daily.id,
        )
        session.add(artifact)
        await session.flush()
        for panel, path in zip(panels, panel_paths):
            session.add(Panel(
                artifact_id=artifact.id,
                panel_no=panel.panel_id,
                storyboard_json=panel.model_dump(mode="json"),
                image_key=str(path),
                prompt_snapshot=prompts[panel.panel_id],
                status="completed",
            ))
        job.result_json = {
            "artifact_id": artifact.id,
            "daily_diary_id": daily.id,
            "version": daily.generation_version,
            "page_count": len(panels),
            "composite_comic_url": context["storage"].get_file_url(composite_path),
        }
        await session.commit()


async def execute_storybook_job(context: dict, job_id: str) -> None:
    try:
        await _execute_storybook_job(context, job_id)
    except Exception as exc:
        session_factory = context["session_factory"]
        async with session_factory() as session:
            job = await session.get(Job, job_id)
            if job is None or job.status in {"done", "failed", "cancelled"}:
                return
            job.status = "failed"
            job.stage = "failed"
            job.error = type(exc).__name__
            job.finished_at = datetime.now(timezone.utc)
            daily_id = job.request_json.get("daily_diary_id")
            if daily_id:
                daily = await session.get(DailyDiary, daily_id)
                if daily is not None:
                    daily.status = "failed"
            await session.commit()
