import asyncio
from datetime import datetime, timezone
from pathlib import Path
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.api.deps import TEST_USER_ID
from voonie.backend.app.db.models import Base, DiaryArtifact, Job, Panel, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.models.schemas import (
    CharacterConfig,
    ComicGenerationResponse,
    ComicPanel,
    GenerateComicFromTextRequest,
    RegeneratePanelRequest,
    Storyboard,
)
from voonie.backend.app.services.audio_duration import (
    AudioMetadataError,
    audio_duration_seconds,
    is_within_audio_duration_limit,
)
from voonie.backend.app.services.legacy_diary_sanitizer import sanitize_legacy_diary_result
from voonie.backend.app.workers.comic_job import execute_comic_job

router = APIRouter(prefix="/diaries", tags=["Diaries"])


def normalized_created_at(value: str | None, fallback: datetime) -> str:
    parsed = fallback
    if value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            parsed = fallback
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def compatibility_response(job: Job) -> ComicGenerationResponse:
    result = sanitize_legacy_diary_result(job.result_json or {}, job.request_json)
    return ComicGenerationResponse(
        task_id=job.id,
        job_id=job.id,
        entry_id=result.get("entry_id", job.request_json.get("entry_id")),
        title=result["title"],
        raw_transcript=result.get("raw_transcript", job.request_json.get("text", "")),
        organized_diary=result.get(
            "organized_diary",
            result.get("raw_transcript", job.request_json.get("text", "")),
        ),
        emotion=result["emotion"],
        emotion_curve=result.get(
            "emotion_curve",
            [{
                "label": result["emotion"]["emotion_label_zh"],
                "intensity": result["emotion"]["mood_score"],
                "evidence": result.get("raw_transcript", job.request_json.get("text", ""))[:40],
            }],
        ),
        key_quote=result.get("key_quote"),
        panels=result["panels"],
        composite_comic_url=result.get("composite_comic_url"),
        companion_note=result["companion_note"],
        created_at=normalized_created_at(result.get("created_at"), job.created_at),
    )


def deprecate(response: Response) -> None:
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "Wed, 27 Aug 2027 00:00:00 GMT"
    response.headers["Link"] = '</api/v1/jobs/comic>; rel="successor-version"'


async def run_compat_job(
    request: Request, db: AsyncSession, user: User, payload: dict, key: str | None
) -> Job | JSONResponse:
    # Some legacy tests instantiate TestClient without entering its lifespan.
    if request.app.state.settings.TESTING:
        async with request.app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        if await db.get(User, TEST_USER_ID) is None:
            db.add(User(id=TEST_USER_ID, device_id="test-device"))
            await db.commit()
    if key:
        existing = await db.scalar(select(Job).where(Job.user_id == user.id, Job.idempotency_key == key))
        if existing is not None:
            if existing.status == "done":
                return existing
            raise HTTPException(status_code=409, detail="An unfinished request already uses this idempotency key")
    await request.app.state.rate_limiter.consume(
        db,
        user.id,
        "comic",
        request.app.state.settings.COMIC_HOURLY_LIMIT,
        commit=False,
    )
    job = Job(user_id=user.id, type="comic", request_json=payload, idempotency_key=key)
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if key is None:
            raise
        existing = await db.scalar(select(Job).where(Job.user_id == user.id, Job.idempotency_key == key))
        if existing is None:
            raise
        if existing.status == "done":
            return existing
        raise HTTPException(status_code=409, detail="An unfinished request already uses this idempotency key")
    await db.refresh(job)
    context = {
        "session_factory": request.app.state.db_session_factory,
        "storyboard_agent": request.app.state.storyboard_agent,
        "image_service": request.app.state.image_service,
        "composer": request.app.state.composer,
        "storage": request.app.state.storage,
        "embedding_provider": request.app.state.embedding_provider,
    }
    task = asyncio.create_task(execute_comic_job(context, job.id))
    request.app.state.inline_tasks.add(task)
    task.add_done_callback(request.app.state.inline_tasks.discard)
    done, _ = await asyncio.wait({task}, timeout=request.app.state.settings.COMPAT_WAIT_SECONDS)
    if not done:
        return JSONResponse(status_code=202, content={"job_id": job.id, "status": "queued"})
    await task
    await db.refresh(job)
    if job.status != "done":
        raise HTTPException(status_code=502, detail=job.error or "Comic generation failed")
    return job


@router.get("", response_model=list[ComicGenerationResponse])
async def list_diaries(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    jobs = (await db.scalars(
        select(Job).join(DiaryArtifact, DiaryArtifact.job_id == Job.id)
        .where(Job.user_id == current_user.id, Job.status == "done")
        .order_by(Job.created_at.desc())
    )).all()
    return [compatibility_response(job) for job in jobs]


@router.get("/{job_id}", response_model=ComicGenerationResponse)
async def get_diary(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await db.scalar(
        select(Job)
        .join(DiaryArtifact, DiaryArtifact.job_id == Job.id)
        .where(Job.id == job_id, Job.user_id == current_user.id, Job.status == "done")
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Diary not found")
    return compatibility_response(job)


@router.delete("/{job_id}", status_code=204)
async def delete_diary(
    job_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    job = await db.scalar(select(Job).where(Job.id == job_id, Job.user_id == current_user.id))
    if job is None:
        raise HTTPException(status_code=404, detail="Diary not found")
    artifact = await db.scalar(select(DiaryArtifact).where(DiaryArtifact.job_id == job.id, DiaryArtifact.user_id == current_user.id))
    if artifact is not None:
        panels = list((await db.scalars(select(Panel).where(Panel.artifact_id == artifact.id))).all())
        for key in [artifact.composite_key, *artifact.panel_keys_json, *(panel.image_key for panel in panels)]:
            request.app.state.storage.delete(key)
        await db.delete(artifact)
    await db.delete(job)
    await db.commit()


@router.post("/{job_id}/panels/{panel_no}/regenerate", response_model=ComicGenerationResponse)
async def regenerate_panel(
    job_id: str,
    panel_no: int,
    request: Request,
    body: RegeneratePanelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if panel_no < 1 or panel_no > 5:
        raise HTTPException(status_code=400, detail="panel_no must be between 1 and 5")
    job = await db.scalar(select(Job).where(Job.id == job_id, Job.user_id == current_user.id))
    if job is None:
        raise HTTPException(status_code=404, detail="Diary not found")
    artifact = await db.scalar(select(DiaryArtifact).where(DiaryArtifact.job_id == job.id, DiaryArtifact.user_id == current_user.id))
    if artifact is None:
        raise HTTPException(status_code=404, detail="Diary artifact not found")
    panels = list((await db.scalars(select(Panel).where(Panel.artifact_id == artifact.id).order_by(Panel.panel_no))).all())
    target_panel = next((p for p in panels if p.panel_no == panel_no), None)
    if target_panel is None:
        raise HTTPException(status_code=404, detail=f"Panel {panel_no} not found")

    storyboard_panel = ComicPanel.model_validate(target_panel.storyboard_json)
    if body and body.custom_prompt:
        storyboard_panel.scene_desc = f"{storyboard_panel.scene_desc}, {body.custom_prompt}"

    snapshot = artifact.character_snapshot_json or {}
    character = (body.character if body and body.character else None) or CharacterConfig(
        character_name=snapshot.get("character_name", "我"),
        appearance_prompt=snapshot.get("appearance_prompt", CharacterConfig().appearance_prompt),
        style_preset=snapshot.get("style_preset", "chibi_manga"),
    )
    custom_style = (body.custom_style if body and body.custom_style else None)

    image_path, prompt = await request.app.state.image_service.generate_panel_image(
        storyboard_panel,
        character,
        custom_style,
    )
    storyboard_panel.image_url = request.app.state.storage.get_file_url(image_path)

    if target_panel.image_key and target_panel.image_key != str(image_path):
        request.app.state.storage.delete(target_panel.image_key)

    target_panel.image_key = str(image_path)
    target_panel.prompt_snapshot = prompt
    target_panel.status = "completed"
    target_panel.retry_count += 1
    target_panel.storyboard_json = storyboard_panel.model_dump(mode="json")

    rebuilt_panels = [ComicPanel.model_validate(item.storyboard_json) for item in panels]
    previous_result = job.result_json or {}

    storyboard = Storyboard(
        title=artifact.title,
        organized_diary=previous_result.get("organized_diary", artifact.transcript_redacted),
        emotion={
            "primary_emotion": artifact.emotion_label,
            "emotion_label_zh": artifact.emotion_label,
            "mood_score": artifact.mood_score,
            "analysis": artifact.companion_note,
        },
        emotion_curve=previous_result.get("emotion_curve") or [{
            "label": artifact.emotion_label,
            "intensity": artifact.mood_score,
            "evidence": artifact.transcript_redacted[:40],
        }],
        key_quote=previous_result.get("key_quote"),
        panels=rebuilt_panels,
        companion_note=artifact.companion_note,
    )
    panel_paths = [Path(item.image_key) for item in panels]
    if artifact.composite_key:
        request.app.state.storage.delete(artifact.composite_key)
    artifact.composite_key = None
    artifact.panel_keys_json = [str(path) for path in panel_paths]
    job.result_json = {
        "title": storyboard.title,
        "organized_diary": storyboard.organized_diary,
        "emotion": storyboard.emotion.model_dump(mode="json"),
        "emotion_curve": [point.model_dump(mode="json") for point in storyboard.emotion_curve],
        "key_quote": storyboard.key_quote,
        "panels": [panel.model_dump(mode="json") for panel in storyboard.panels],
        "composite_comic_url": None,
        "companion_note": storyboard.companion_note,
        "raw_transcript": job.request_json.get("text", "") if job.request_json else "",
        "created_at": previous_result.get("created_at") or normalized_created_at(None, job.created_at),
    }
    await db.commit()
    await db.refresh(job)
    return compatibility_response(job)


@router.post("/text-generate", response_model=ComicGenerationResponse)
async def generate_from_text(
    req: GenerateComicFromTextRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    deprecate(response)
    payload = req.model_dump(mode="json") | {
        "local_id": idempotency_key or uuid.uuid4().hex,
        "input_type": "text",
    }
    job = await run_compat_job(request, db, current_user, payload, idempotency_key)
    if isinstance(job, JSONResponse):
        return job
    return compatibility_response(job)


@router.post("/voice-generate", response_model=ComicGenerationResponse)
async def generate_from_voice(
    request: Request,
    response: Response,
    audio_file: UploadFile = File(...),
    character_name: str = Form(default="我"),
    appearance_prompt: str = Form(default="a cute girl with short hair and yellow hoodie"),
    style_preset: str = Form(default="chibi_manga"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    deprecate(response)
    content_type = (audio_file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in request.app.state.settings.ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported audio MIME type")
    if (
        not request.app.state.asr_service.supports_real_transcription
        and not request.app.state.settings.ALLOW_MOCK_ASR
        and not request.app.state.settings.TESTING
    ):
        raise HTTPException(
            status_code=503,
            detail="服务器尚未配置真实语音识别；请使用浏览器实时识别或直接输入文字",
        )
    chunks: list[bytes] = []
    size = 0
    while chunk := await audio_file.read(1024 * 1024):
        size += len(chunk)
        if size > request.app.state.settings.MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio file exceeds the configured size limit")
        chunks.append(chunk)
    audio = b"".join(chunks)
    if not audio:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if content_type == "audio/wav" and not (audio.startswith(b"RIFF") and audio[8:12] == b"WAVE"):
        raise HTTPException(status_code=415, detail="Audio content does not match its declared type")
    suffix = Path(audio_file.filename or "voice.bin").suffix.lower() or ".bin"
    temp_path = request.app.state.settings.TEMP_MEDIA_DIR / f"compat_voice_{uuid.uuid4().hex}{suffix}"
    try:
        temp_path.write_bytes(audio)
        try:
            duration = await asyncio.to_thread(audio_duration_seconds, temp_path, content_type)
        except AudioMetadataError as exc:
            raise HTTPException(status_code=415, detail="Audio duration metadata is invalid") from exc
        if not is_within_audio_duration_limit(duration, request.app.state.settings.MAX_AUDIO_SECONDS):
            raise HTTPException(status_code=413, detail="Audio duration exceeds the configured limit")
        transcript = await request.app.state.asr_service.transcribe(audio, filename=audio_file.filename)
    finally:
        temp_path.unlink(missing_ok=True)
    character = CharacterConfig(
        character_name=character_name,
        appearance_prompt=appearance_prompt,
        style_preset=style_preset,
    )
    payload = {
        "text": transcript,
        "character": character.model_dump(mode="json"),
        "custom_style": None,
        "local_id": idempotency_key or uuid.uuid4().hex,
        "input_type": "voice",
    }
    job = await run_compat_job(request, db, current_user, payload, idempotency_key)
    if isinstance(job, JSONResponse):
        return job
    return compatibility_response(job)
