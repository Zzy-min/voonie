import uuid
import asyncio
import base64
import hashlib
import json
from io import BytesIO
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, Header, Query, Request, UploadFile, status
from PIL import Image
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import Character, DiaryArtifact, DiaryEntry, DiaryReference, Job, Panel, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.entries import EntryListResponse, EntryResponse, EntryUpdate, TextEntryCreate
from voonie.backend.app.api.routers.jobs import enqueue_comic_job
from voonie.backend.app.models.schemas import CharacterConfig
from voonie.backend.app.schemas.jobs import EntryComicJobRequest, JobQueuedResponse
from voonie.backend.app.services.audio_duration import (
    AudioMetadataError,
    audio_duration_seconds,
    is_within_audio_duration_limit,
    resolve_audio_content_type,
)

router = APIRouter(prefix="/entries", tags=["Entries"])

REFERENCE_TYPES = {"subject", "style", "scene", "tone", "combined"}
MAX_REFERENCE_BYTES = 5 * 1024 * 1024
MAX_REFERENCE_PIXELS = 24_000_000


def source_fingerprint(input_type: str, content_hash: str, entry_date: datetime, timezone_name: str) -> str:
    payload = json.dumps(
        [input_type, content_hash, entry_date.astimezone(timezone.utc).isoformat(), timezone_name],
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def serialize(entry: DiaryEntry) -> EntryResponse:
    return EntryResponse(
        id=entry.id,
        local_id=entry.local_id,
        entry_date=entry.entry_date,
        timezone=entry.timezone,
        input_type=entry.input_type,
        redacted_text=entry.redacted_text,
        emotion=entry.emotion_json,
        events=entry.event_json,
        status=entry.status,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


async def owned_entry(db: AsyncSession, entry_id: str, user_id: str) -> DiaryEntry:
    entry = await db.scalar(select(DiaryEntry).where(DiaryEntry.id == entry_id, DiaryEntry.user_id == user_id))
    if entry is None:
        raise ApiError(404, "entry_not_found", "Diary entry not found")
    return entry


async def insert_entry(db: AsyncSession, entry: DiaryEntry) -> DiaryEntry:
    db.add(entry)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(DiaryEntry).where(DiaryEntry.user_id == entry.user_id, DiaryEntry.local_id == entry.local_id)
        )
        if existing is None:
            raise
        if existing.event_json.get("_source_hash") != entry.event_json.get("_source_hash"):
            raise ApiError(409, "idempotency_conflict", "local_id was already used for different content")
        return existing
    await db.refresh(entry)
    return entry


async def analyze_entry_text(request: Request, text: str, extra: dict | None = None) -> tuple[dict, dict, str]:
    extra = extra or {}
    try:
        analysis = await request.app.state.diary_analyzer.analyze(text)
        events = analysis.stored_events(extra)
        return analysis.public_emotion(), events, "confirmed" if extra.get("_confirmed", True) else extra.get("_status", "confirmed")
    except Exception:
        events = extra | {"analysis_error": "invalid_json"}
        return {}, events, "analysis_failed"


@router.post("/text", response_model=EntryResponse, status_code=status.HTTP_201_CREATED)
async def create_text_entry(
    body: TextEntryCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=255),
) -> EntryResponse:
    if idempotency_key != body.local_id:
        raise ApiError(409, "idempotency_mismatch", "Idempotency-Key must match local_id")
    source_hash = source_fingerprint(
        "text", hashlib.sha256(body.text.encode("utf-8")).hexdigest(), body.entry_date, body.timezone
    )
    emotion, events, status_name = await analyze_entry_text(
        request, body.text, extra={"_source_hash": source_hash}
    )
    entry = DiaryEntry(
        user_id=current_user.id,
        local_id=body.local_id,
        entry_date=body.entry_date.astimezone(timezone.utc),
        timezone=body.timezone,
        input_type="text",
        redacted_text=body.text,
        status=status_name,
        emotion_json=emotion,
        event_json=events,
    )
    return serialize(await insert_entry(db, entry))


@router.post("/voice", response_model=EntryResponse, status_code=status.HTTP_201_CREATED)
async def create_voice_entry(
    request: Request,
    audio_file: UploadFile = File(...),
    local_id: str = Form(min_length=1, max_length=255),
    entry_date: datetime = Form(),
    timezone_name: str = Form(default="UTC", alias="timezone"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=255),
) -> EntryResponse:
    if idempotency_key != local_id:
        raise ApiError(409, "idempotency_mismatch", "Idempotency-Key must match local_id")
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ApiError(422, "invalid_timezone", "Unknown IANA timezone") from exc
    if entry_date.tzinfo is None or entry_date.utcoffset() is None:
        raise ApiError(422, "invalid_entry_date", "entry_date must include a UTC offset")
    entry_date = entry_date.astimezone(timezone.utc)
    declared_type = (audio_file.content_type or "").split(";", 1)[0].strip().lower()
    if (
        not request.app.state.asr_service.supports_real_transcription
        and not request.app.state.settings.ALLOW_MOCK_ASR
        and not request.app.state.settings.TESTING
    ):
        raise ApiError(
            503,
            "asr_not_configured",
            "服务器尚未配置真实语音识别；请使用浏览器实时识别或直接输入文字",
        )

    suffix = Path(audio_file.filename or "voice.bin").suffix.lower() or ".bin"
    temp_path = request.app.state.settings.TEMP_MEDIA_DIR / f"voice_{uuid.uuid4().hex}{suffix}"
    size = 0
    reserved = False
    content_hasher = hashlib.sha256()
    header = bytearray()
    try:
        with temp_path.open("wb") as output:
            while chunk := await audio_file.read(1024 * 1024):
                size += len(chunk)
                if size > request.app.state.settings.MAX_AUDIO_BYTES:
                    raise ApiError(413, "audio_too_large", "Audio file exceeds the configured size limit")
                content_hasher.update(chunk)
                if len(header) < 16:
                    header.extend(chunk[: 16 - len(header)])
                output.write(chunk)
        if size == 0:
            raise ApiError(400, "empty_audio", "Audio file is empty")
        content_type = resolve_audio_content_type(declared_type, bytes(header))
        if content_type not in request.app.state.settings.ALLOWED_AUDIO_TYPES:
            raise ApiError(415, "unsupported_audio_type", "Unsupported audio MIME type")
        if content_type == "audio/wav":
            valid_signature = bytes(header).startswith(b"RIFF") and bytes(header)[8:12] == b"WAVE"
            if not valid_signature:
                raise ApiError(415, "invalid_audio_content", "Audio content does not match its declared type")
        try:
            duration = await asyncio.to_thread(audio_duration_seconds, temp_path, content_type)
        except AudioMetadataError as exc:
            raise ApiError(415, "invalid_audio_content", "Audio duration metadata is invalid") from exc
        if not is_within_audio_duration_limit(duration, request.app.state.settings.MAX_AUDIO_SECONDS):
            raise ApiError(413, "audio_too_long", "Audio duration exceeds the configured limit")

        source_hash = source_fingerprint("voice", content_hasher.hexdigest(), entry_date, timezone_name)
        existing = await db.scalar(
            select(DiaryEntry).where(DiaryEntry.user_id == current_user.id, DiaryEntry.local_id == local_id)
        )
        if existing is not None:
            if existing.status == "processing":
                lease = existing.audio_delete_after
                now = datetime.now(timezone.utc)
                if lease is not None and lease.tzinfo is None:
                    lease = lease.replace(tzinfo=timezone.utc)
                if lease is None or lease > now:
                    if existing.event_json.get("_source_hash") != source_hash:
                        raise ApiError(409, "idempotency_conflict", "local_id was already used for different content")
                    raise ApiError(409, "entry_processing", "The matching voice entry is still being transcribed")
                await db.delete(existing)
                await db.commit()
            else:
                if existing.event_json.get("_source_hash") != source_hash:
                    raise ApiError(409, "idempotency_conflict", "local_id was already used for different content")
                return serialize(existing)
        placeholder = DiaryEntry(
            user_id=current_user.id, local_id=local_id, entry_date=entry_date, timezone=timezone_name,
            input_type="voice", redacted_text="", event_json={"_source_hash": source_hash}, status="processing",
            audio_delete_after=datetime.now(timezone.utc) + timedelta(minutes=15),
        )
        db.add(placeholder)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            winner = await db.scalar(
                select(DiaryEntry).where(DiaryEntry.user_id == current_user.id, DiaryEntry.local_id == local_id)
            )
            if winner is None or winner.event_json.get("_source_hash") != source_hash:
                raise ApiError(409, "idempotency_conflict", "local_id was already used for different content")
            if winner.redacted_text:
                return serialize(winner)
            raise ApiError(409, "entry_processing", "The matching voice entry is still being transcribed")
        await db.refresh(placeholder)
        reserved = True
        audio_bytes = await asyncio.to_thread(temp_path.read_bytes)
        audio = await request.app.state.asr_service.transcribe(audio_bytes, filename=audio_file.filename or temp_path.name)
        emotion, events, status_name = await analyze_entry_text(
            request,
            audio,
            extra={"_source_hash": source_hash, "_status": "draft", "_confirmed": False},
        )
        placeholder.redacted_text = audio
        placeholder.emotion_json = emotion
        placeholder.event_json = events
        placeholder.status = "draft" if status_name != "analysis_failed" else "analysis_failed"
        placeholder.audio_delete_after = None
        await db.commit()
        await db.refresh(placeholder)
        return serialize(placeholder)
    except Exception:
        if reserved and placeholder.status == "processing":
            await db.delete(placeholder)
            await db.commit()
        raise
    finally:
        temp_path.unlink(missing_ok=True)


@router.get("", response_model=EntryListResponse)
async def list_entries(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    date_filter: date | None = Query(default=None, alias="date"),
    timezone_name: str = Query(default="UTC", alias="timezone"),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
) -> EntryListResponse:
    query = select(DiaryEntry).where(DiaryEntry.user_id == current_user.id)
    if date_filter:
        try:
            zone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ApiError(422, "invalid_timezone", "Unknown IANA timezone") from exc
        start = datetime.combine(date_filter, time.min, tzinfo=zone).astimezone(timezone.utc)
        end = datetime.combine(date_filter, time.max, tzinfo=zone).astimezone(timezone.utc)
        query = query.where(DiaryEntry.entry_date.between(start, end))
    if cursor:
        try:
            cursor_time_raw, cursor_id = cursor.rsplit("|", 1)
            cursor_time = datetime.fromisoformat(cursor_time_raw)
        except ValueError as exc:
            raise ApiError(422, "invalid_cursor", "Invalid pagination cursor") from exc
        query = query.where(or_(
            DiaryEntry.created_at < cursor_time,
            (DiaryEntry.created_at == cursor_time) & (DiaryEntry.id < cursor_id),
        ))
    rows = (await db.scalars(
        query.order_by(DiaryEntry.created_at.desc(), DiaryEntry.id.desc()).limit(limit + 1)
    )).all()
    next_cursor = f"{rows[limit - 1].created_at.isoformat()}|{rows[limit - 1].id}" if len(rows) > limit else None
    return EntryListResponse(items=[serialize(row) for row in rows[:limit]], next_cursor=next_cursor)


@router.get("/{entry_id}", response_model=EntryResponse)
async def get_entry(entry_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return serialize(await owned_entry(db, entry_id, current_user.id))


@router.patch("/{entry_id}", response_model=EntryResponse)
async def update_entry(
    body: EntryUpdate,
    entry_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await owned_entry(db, entry_id, current_user.id)
    changes = body.model_dump(exclude_unset=True)
    if "text" in changes:
        entry.redacted_text = changes.pop("text")
    if "entry_date" in changes:
        changes["entry_date"] = changes["entry_date"].astimezone(timezone.utc)
    for key, value in changes.items():
        setattr(entry, key, value)
    if "text" in body.model_fields_set or body.status == "confirmed":
        extra = {"_source_hash": entry.event_json.get("_source_hash")}
        emotion, events, status_name = await analyze_entry_text(request, entry.redacted_text, extra=extra)
        entry.emotion_json = emotion
        entry.event_json = events
        if body.status is None and status_name == "analysis_failed":
            entry.status = "analysis_failed"
    if "text" in body.model_fields_set:
        artifacts = (
            await db.scalars(
                select(DiaryArtifact).where(
                    DiaryArtifact.entry_id == entry.id,
                    DiaryArtifact.user_id == current_user.id,
                )
            )
        ).all()
        for artifact in artifacts:
            artifact.transcript_redacted = entry.redacted_text
            job = await db.get(Job, artifact.job_id)
            if job is None or job.user_id != current_user.id or job.result_json is None:
                continue
            result = dict(job.result_json)
            result["organized_diary"] = entry.redacted_text
            job.result_json = result
    await db.commit()
    await db.refresh(entry)
    return serialize(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    entry = await owned_entry(db, entry_id, current_user.id)
    references = list((await db.scalars(select(DiaryReference).where(
        DiaryReference.entry_id == entry.id,
        DiaryReference.user_id == current_user.id,
    ))).all())
    for reference in references:
        request.app.state.storage.delete(reference.media_key)
    artifacts = list((await db.scalars(select(DiaryArtifact).where(
        DiaryArtifact.entry_id == entry.id,
        DiaryArtifact.user_id == current_user.id,
    ))).all())
    for artifact in artifacts:
        panels = list((await db.scalars(select(Panel).where(Panel.artifact_id == artifact.id))).all())
        for key in [artifact.composite_key, *artifact.panel_keys_json, *(panel.image_key for panel in panels)]:
            request.app.state.storage.delete(key)
        job = await db.get(Job, artifact.job_id)
        await db.delete(artifact)
        if job is not None and job.user_id == current_user.id:
            await db.delete(job)
    request.app.state.storage.delete(entry.audio_key)
    await db.delete(entry)
    await db.commit()


@router.post("/{entry_id}/references", status_code=status.HTTP_201_CREATED)
async def upload_diary_reference(
    entry_id: str,
    request: Request,
    reference_type: str = Form("combined"),
    include_in_content: bool = Form(False),
    paragraph_anchor: str | None = Form(None),
    image_file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    entry = await owned_entry(db, entry_id, current_user.id)
    if reference_type not in REFERENCE_TYPES:
        raise ApiError(422, "invalid_reference_type", "Unsupported diary reference type")
    chunks: list[bytes] = []
    size = 0
    while chunk := await image_file.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_REFERENCE_BYTES:
            raise ApiError(413, "image_too_large", "Reference image exceeds 5MB")
        chunks.append(chunk)
    payload = b"".join(chunks)
    if not payload:
        raise ApiError(400, "empty_image", "Reference image is empty")
    try:
        with Image.open(BytesIO(payload)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_REFERENCE_PIXELS:
                raise ApiError(413, "image_dimensions_too_large", "Reference image dimensions exceed the limit")
            image.verify()
    except ApiError:
        raise
    except Exception as exc:
        raise ApiError(415, "invalid_image", "Reference image is not valid") from exc
    saved = request.app.state.storage.save_bytes(payload, suffix=".png")
    reference = DiaryReference(
        user_id=current_user.id,
        entry_id=entry.id,
        media_key=str(saved),
        reference_type=reference_type,
        paragraph_anchor=(paragraph_anchor or "").strip()[:500] or None,
        include_in_content=include_in_content,
        width=width,
        height=height,
    )
    db.add(reference)
    await db.commit()
    await db.refresh(reference)
    return {
        "id": reference.id,
        "reference_type": reference.reference_type,
        "include_in_content": reference.include_in_content,
        "paragraph_anchor": reference.paragraph_anchor,
        "image_url": request.app.state.storage.get_file_url(reference.media_key),
        "width": reference.width,
        "height": reference.height,
    }


@router.post("/{entry_id}/comic-jobs", response_model=JobQueuedResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_entry_comic_job(
    entry_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    body: EntryComicJobRequest | None = None,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=255),
) -> JobQueuedResponse:
    entry = await owned_entry(db, entry_id, current_user.id)
    if not entry.redacted_text:
        raise ApiError(409, "entry_not_ready", "Diary entry has no confirmed text yet")
    character = body.character if body else CharacterConfig()
    character_bible = None
    character_seed = None
    reference_b64 = body.ref_image_b64 if body else None
    diary_reference = None
    if body and body.reference_id:
        diary_reference = await db.scalar(select(DiaryReference).where(
            DiaryReference.id == body.reference_id,
            DiaryReference.entry_id == entry.id,
            DiaryReference.user_id == current_user.id,
        ))
        if diary_reference is None:
            raise ApiError(404, "diary_reference_not_found", "Diary reference not found")
        reference_path = Path(diary_reference.media_key)
        if not reference_path.is_file():
            raise ApiError(410, "diary_reference_missing", "Diary reference file is missing")
        reference_b64 = base64.b64encode(reference_path.read_bytes()).decode("ascii")
    if body and body.character_id:
        saved_character = await db.scalar(
            select(Character)
            .options(selectinload(Character.references))
            .where(Character.id == body.character_id, Character.user_id == current_user.id)
        )
        if saved_character is None:
            raise ApiError(404, "character_not_found", "Character not found")
        character = CharacterConfig(
            character_name=saved_character.name,
            appearance_prompt=saved_character.appearance_prompt,
            style_preset=saved_character.style_preset,
        )
        character_bible = saved_character.bible_json
        character_seed = saved_character.seed
        # 早期版本为所有自定义角色写入了默认女孩设定，导致男生或其他形象
        # 与“棕色短发、黄色卫衣、圆眼镜”冲突。只兼容清理这组旧默认值，
        # 用户显式维护过的角色 bible 仍完整保留。
        if (
            character_bible.get("hair") == "short brown hair"
            and character_bible.get("outfit") == "oversized yellow hoodie"
            and character_bible.get("features") == "round glasses"
        ):
            character_bible = {
                "age_range": "young adult",
                "hair": "follow the main protagonist description exactly",
                "outfit": "follow the main protagonist description exactly",
                "body": "natural human anatomy",
                "features": "follow the main protagonist description exactly",
                "accessories": "follow the main protagonist description exactly",
                "locked": ["human identity", "hairstyle", "main outfit", "facial features"],
            }
        approved_reference = next(
            (item for item in saved_character.references if item.moderation_status == "approved"),
            None,
        )
        if approved_reference and Path(approved_reference.media_key).is_file():
            reference_b64 = base64.b64encode(Path(approved_reference.media_key).read_bytes()).decode("ascii")
    payload = {
        "text": entry.redacted_text,
        "character": character.model_dump(mode="json"),
        "character_bible": character_bible,
        "character_seed": character_seed,
        "custom_style": body.custom_style if body else None,
        "ref_image_b64": reference_b64,
        "local_id": entry.local_id,
        "timezone": entry.timezone,
        "input_type": entry.input_type,
        "entry_id": entry.id,
        "reference_image": ({
            "id": diary_reference.id,
            "image_url": request.app.state.storage.get_file_url(diary_reference.media_key),
            "reference_type": diary_reference.reference_type,
            "include_in_content": diary_reference.include_in_content,
            "paragraph_anchor": diary_reference.paragraph_anchor,
        } if diary_reference else None),
    }
    return await enqueue_comic_job(request, db, current_user, payload, idempotency_key)
