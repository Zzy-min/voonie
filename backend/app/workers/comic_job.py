import asyncio
import base64
import time
import httpx
import logging
from datetime import datetime, timezone
from typing import Any

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import DiaryArtifact, DiaryEntry, Job, Panel
from voonie.backend.app.db.models import MemoryItem, User
from voonie.backend.app.models.schemas import CharacterConfig
from voonie.backend.app.services.comic_composer import ComicComposer
from voonie.backend.app.services.image_gen_service import ImageGenService
from voonie.backend.app.services.storage_service import StorageService
from voonie.backend.app.services.storyboard_agent import StoryboardAgent
from voonie.backend.app.services.prompt_builder import character_snapshot
from voonie.backend.app.services.visual_subject import resolve_visual_character
from voonie.backend.app.services.content_review import ContentReview
from voonie.backend.app.workers.cleanup import cleanup_cron
from voonie.backend.app.providers.embeddings import get_embedding_provider


async def update_job(
    session_factory,
    job_id: str,
    *,
    status: str,
    stage: str,
    progress: float,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    finished: bool = False,
) -> bool:
    async with session_factory() as session:
        values = {
            "status": status,
            "stage": stage,
            "progress": progress,
            "result_json": result,
            "error": error,
            "finished_at": datetime.now(timezone.utc) if finished else None,
        }
        changed = await session.execute(
            update(Job)
            .where(Job.id == job_id, Job.status.not_in({"done", "failed", "cancelled"}))
            .values(**values)
        )
        await session.commit()
        return changed.rowcount == 1


async def execute_comic_job(context: dict[str, Any], job_id: str) -> None:
    started_at = time.perf_counter()
    session_factory = context["session_factory"]
    async with session_factory() as session:
        claimed = await session.execute(
            update(Job)
            .where(Job.id == job_id, Job.status == "queued")
            .values(status="running", stage="planning", progress=0.1)
        )
        await session.commit()
        if claimed.rowcount != 1:
            return
        job = await session.get(Job, job_id)
        if job is None:
            return
        request_data = dict(job.request_json)
        queued_at = job.created_at.replace(tzinfo=timezone.utc) if job.created_at.tzinfo is None else job.created_at
        logging.getLogger("voonie.performance").info("job_queue_ms=%d", max(0, int((datetime.now(timezone.utc) - queued_at).total_seconds() * 1000)))
        owner = await session.get(User, job.user_id)
        user_nickname = (owner.nickname or "小主人").strip() if owner else "小主人"

    try:
        character = resolve_visual_character(
            request_data["text"], CharacterConfig.model_validate(request_data.get("character", {}))
        )
        aspect_ratio = request_data.get("aspect_ratio", "4:3")
        custom_style = request_data.get("custom_style")
        base_style = custom_style or context["image_service"].settings.STYLE_PRESETS.get(
            character.style_preset,
            context["image_service"].settings.STYLE_PRESETS["chibi_manga"],
        )
        framing_prompt = (
            f"Canvas aspect ratio {aspect_ratio}. Keep the main character's full head, face, "
            "and key action completely inside frame with generous safe margins; no cropped head or limbs."
        )
        effective_style = f"{base_style}\n{framing_prompt}"
        storyboard = await context["storyboard_agent"].generate_storyboard(
            request_data["text"],
            character,
            effective_style,
            user_nickname,
        )
        if owner and owner.wechat_openid and context["image_service"].settings.CONTENT_REVIEW_ENABLED:
            async with httpx.AsyncClient() as client:
                await ContentReview(context["image_service"].settings, client).check_text(
                    "\n".join([
                        storyboard.title,
                        storyboard.organized_diary,
                        storyboard.companion_note or "",
                        storyboard.key_quote or "",
                        *[
                            " ".join(str(value or "") for value in (
                                panel.scene_desc, panel.character_action, panel.narration,
                                panel.speech_bubble.model_dump_json() if panel.speech_bubble else "",
                                panel.sfx, panel.visual_reason,
                            ))
                            for panel in storyboard.panels
                        ],
                    ]),
                    owner.wechat_openid if owner else None,
                )

        ref_image_b64 = request_data.get("ref_image_b64")
        ref_image_bytes = None
        if ref_image_b64 and character.visual_identity == "human":
            try:
                data = ref_image_b64.split(",", 1)[-1] if "," in ref_image_b64 else ref_image_b64
                ref_image_bytes = base64.b64decode(data, validate=True)
            except Exception:
                ref_image_bytes = None

        if not await update_job(session_factory, job_id, status="running", stage="rendering", progress=0.25):
            return
        character_bible = request_data.get("character_bible")
        identity_seed = request_data.get("character_seed")
        reference_images = []
        reference_types = []
        for reference in request_data.get("reference_inputs", []):
            # Human subject photos must not replace an explicitly nonhuman narrator.
            if character.visual_identity != "human" and reference["type"] == "subject":
                continue
            reference_images.append(base64.b64decode(reference["image_b64"], validate=True))
            reference_types.append("scene" if character.visual_identity != "human" and reference["type"] == "combined" else reference["type"])

        async def render_one(index_panel, identity_reference):
            render_started = time.perf_counter()
            index, panel = index_panel
            reference_options = {"ref_images": reference_images, "reference_types": reference_types} if reference_images else {}
            image_path, prompt = await context["image_service"].generate_panel_image(
                panel,
                character,
                effective_style,
                ref_image=identity_reference,
                character_bible=character_bible,
                seed=identity_seed,
                aspect_ratio=aspect_ratio,
                review_openid=owner.wechat_openid if owner else None,
                **reference_options,
            )
            logging.getLogger("voonie.performance").info("panel_render_ms=%d", int((time.perf_counter() - render_started) * 1000))
            panel.image_url = context["storage"].get_file_url(image_path)
            return index, image_path, prompt

        indexed_panels = list(enumerate(storyboard.panels, start=1))
        first_rendered = await render_one(indexed_panels[0], ref_image_bytes)
        if not await update_job(
            session_factory, job_id, status="running", stage="rendering",
            progress=0.25 + 0.6 / len(indexed_panels),
        ):
            return
        # 后续画面始终复用明确的角色参考；若用户没有上传参考图，就以首图
        # 作为本篇日记的身份锚点，避免每张图独立抽样后更换主人公。
        identity_reference = ref_image_bytes or first_rendered[1].read_bytes()
        async def render_and_report(item):
            rendered_panel = await render_one(item, identity_reference)
            return rendered_panel

        remaining = []
        for completed in asyncio.as_completed(
            [render_and_report(item) for item in indexed_panels[1:]]
        ):
            remaining.append(await completed)
            if not await update_job(
                session_factory, job_id, status="running", stage="rendering",
                progress=0.25 + 0.6 * (1 + len(remaining)) / len(indexed_panels),
            ):
                return
        rendered = [first_rendered, *remaining]
        rendered.sort(key=lambda item: item[0])
        panel_paths = [item[1] for item in rendered]
        prompts = {item[0]: item[2] for item in rendered}

        if not await update_job(session_factory, job_id, status="running", stage="finalizing", progress=0.85):
            return
        result = {
            "title": storyboard.title,
            "organized_diary": storyboard.organized_diary,
            "emotion": storyboard.emotion.model_dump(mode="json"),
            "emotion_curve": [point.model_dump(mode="json") for point in storyboard.emotion_curve],
            "key_quote": storyboard.key_quote,
            "panels": [panel.model_dump(mode="json") for panel in storyboard.panels],
            "composite_comic_url": None,
            "companion_note": storyboard.companion_note,
        }
        async with session_factory() as session:
            completed = await session.execute(
                update(Job).where(Job.id == job_id, Job.status == "running")
                .values(status="done", stage="done", progress=1.0, finished_at=datetime.now(timezone.utc))
            )
            if completed.rowcount != 1:
                await session.rollback()
                for path in panel_paths:
                    context["storage"].delete(path)
                return
            job = await session.get(Job, job_id)
            if job is None:
                return
            entry = None
            if request_data.get("entry_id"):
                entry = await session.get(DiaryEntry, request_data["entry_id"])
            if entry is None:
                entry = DiaryEntry(
                    user_id=job.user_id,
                    local_id=request_data.get("local_id") or job.id,
                    entry_date=datetime.now(timezone.utc),
                    timezone=request_data.get("timezone", "UTC"),
                    input_type=request_data.get("input_type", "text"),
                    redacted_text=request_data["text"],
                    emotion_json=storyboard.emotion.model_dump(mode="json"),
                    event_json={},
                    status="confirmed",
                )
                session.add(entry)
                await session.flush()
            artifact = DiaryArtifact(
                user_id=job.user_id,
                job_id=job.id,
                entry_id=entry.id,
                artifact_type="illustrated_diary",
                version=1,
                title=storyboard.title,
                emotion_label=storyboard.emotion.emotion_label_zh,
                mood_score=storyboard.emotion.mood_score,
                transcript_redacted=storyboard.organized_diary,
                companion_note=storyboard.companion_note,
                composite_key=None,
                panel_keys_json=[str(path) for path in panel_paths],
                character_snapshot_json=character_snapshot(character, request_data.get("character_bible")),
            )
            session.add(artifact)
            await session.flush()
            for index, (panel, path) in enumerate(zip(storyboard.panels, panel_paths), start=1):
                session.add(Panel(
                    artifact_id=artifact.id,
                    panel_no=index,
                    storyboard_json=panel.model_dump(mode="json"),
                    image_key=str(path),
                    prompt_snapshot=prompts[index],
                    status="completed",
                ))
            result.update(
                artifact_id=artifact.id,
                entry_id=entry.id,
                raw_transcript=request_data["text"],
                organized_diary=storyboard.organized_diary,
                emotion_curve=[point.model_dump(mode="json") for point in storyboard.emotion_curve],
                key_quote=storyboard.key_quote,
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            job.result_json = result
            job.error = None
            owner = await session.get(User, job.user_id)
            if owner is not None and owner.wechat_openid is None:
                owner.guest_generated_count += 1
            if owner is not None and owner.memory_opt_in:
                memory_summary = storyboard.organized_diary[:500]
                embedding = None
                if context.get("embedding_provider") is not None:
                    try:
                        embedding = await context["embedding_provider"].embed(
                            f"{storyboard.title} {memory_summary}"
                        )
                    except Exception:
                        embedding = None
                session.add(MemoryItem(
                    user_id=job.user_id,
                    artifact_id=artifact.id,
                    happened_on=entry.entry_date,
                    title=storyboard.title[:255],
                    summary=memory_summary,
                    emotion=storyboard.emotion.emotion_label_zh,
                    mood_score=storyboard.emotion.mood_score,
                    tags_json=["diary"],
                    embedding=embedding,
                ))
            await session.commit()
        logging.getLogger("voonie.performance").info("job_total_ms=%d", int((time.perf_counter() - started_at) * 1000))
    except Exception as exc:
        async with session_factory() as session:
            job = await session.get(Job, job_id)
            if job is not None and job.status not in {"done", "cancelled"}:
                job.status = "failed"
                job.stage = "failed"
                job.progress = 0.0
                job.error = f"{type(exc).__name__}: {exc}"
                job.finished_at = datetime.now(timezone.utc)
                await session.commit()
        raise


async def run_inline_comic_job(context: dict[str, Any], job_id: str) -> None:
    try:
        async with context["inline_job_semaphore"]:
            settings = context.get("settings")
            if settings is None or ":memory:" in settings.DATABASE_URL:
                await execute_comic_job(context, job_id)
                return

            # Keep synchronous image processing off the HTTP event loop.
            def run_in_thread() -> None:
                async def run() -> None:
                    engine = create_async_engine(settings.DATABASE_URL)
                    isolated_context = {
                        **context,
                        "session_factory": async_sessionmaker(engine, expire_on_commit=False),
                    }
                    try:
                        await execute_comic_job(isolated_context, job_id)
                    finally:
                        await engine.dispose()

                asyncio.run(run())

            await asyncio.to_thread(run_in_thread)
    except Exception as exc:
        logging.getLogger("voonie.jobs").exception("inline comic job failed before completion")
        await update_job(
            context["session_factory"], job_id, status="failed", stage="failed",
            progress=0, error=f"{type(exc).__name__}: {exc}", finished=True,
        )


async def generate_comic_job(ctx: dict[str, Any], job_id: str) -> None:
    await execute_comic_job(ctx, job_id)


async def generate_storybook_job(ctx: dict[str, Any], job_id: str) -> None:
    from voonie.backend.app.workers.storybook_job import execute_storybook_job
    await execute_storybook_job(ctx, job_id)


async def generate_panel_retry_job(ctx: dict[str, Any], job_id: str) -> None:
    from voonie.backend.app.workers.panel_retry_job import execute_panel_retry_job
    await execute_panel_retry_job(ctx, job_id)


async def worker_startup(ctx: dict[str, Any]) -> None:
    settings = Settings()
    engine = create_async_engine(settings.DATABASE_URL)
    ctx["engine"] = engine
    ctx["session_factory"] = async_sessionmaker(engine, expire_on_commit=False)
    ctx["storage"] = StorageService(settings)
    ctx["storyboard_agent"] = StoryboardAgent(app_settings=settings)
    ctx["image_service"] = ImageGenService(app_settings=settings, storage=ctx["storage"])
    ctx["composer"] = ComicComposer(storage=ctx["storage"])
    ctx["embedding_provider"] = get_embedding_provider(settings)


async def worker_shutdown(ctx: dict[str, Any]) -> None:
    await ctx["engine"].dispose()


class WorkerSettings:
    functions = [generate_comic_job, generate_storybook_job, generate_panel_retry_job]
    cron_jobs = [cron(cleanup_cron, minute={0, 15, 30, 45})]
    on_startup = worker_startup
    on_shutdown = worker_shutdown
    redis_settings = RedisSettings.from_dsn(Settings().REDIS_URL)
    max_tries = 3
    job_timeout = 600
