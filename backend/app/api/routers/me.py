from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.db.models import Character, DailyDiary, DiaryArtifact, DiaryEntry, Job, MemoryItem, Panel, PetSession, RateLimitCounter, RefreshToken, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.me import PreferencesResponse, PreferencesUpdate


router = APIRouter(prefix="/me", tags=["Me"])


def serialize(user: User) -> PreferencesResponse:
    return PreferencesResponse(
        user_id=user.id,
        nickname=user.nickname,
        quote=user.quote,
        quote_note=user.quote_note,
        memory_opt_in=user.memory_opt_in,
    )


@router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences(current_user: User = Depends(get_current_user)) -> PreferencesResponse:
    return serialize(current_user)


@router.patch("/preferences", response_model=PreferencesResponse)
async def update_preferences(
    body: PreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PreferencesResponse:
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(current_user, key, value)
    if body.memory_opt_in is False:
        await db.execute(delete(MemoryItem).where(MemoryItem.user_id == current_user.id))
        await db.execute(delete(PetSession).where(PetSession.user_id == current_user.id))
    await db.commit()
    await db.refresh(current_user)
    return serialize(current_user)


@router.post("/export")
async def export_data(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    entries = (await db.scalars(select(DiaryEntry).where(DiaryEntry.user_id == current_user.id).order_by(DiaryEntry.created_at.desc()))).all()
    artifacts = (await db.scalars(select(DiaryArtifact).where(DiaryArtifact.user_id == current_user.id).order_by(DiaryArtifact.created_at.desc()))).all()
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user": serialize(current_user).model_dump(mode="json"),
        "entries": [
            {
                "id": item.id,
                "local_id": item.local_id,
                "entry_date": item.entry_date.isoformat(),
                "timezone": item.timezone,
                "input_type": item.input_type,
                "redacted_text": item.redacted_text,
                "emotion": item.emotion_json,
                "status": item.status,
            }
            for item in entries
        ],
        "artifacts": [
            {
                "id": item.id,
                "title": item.title,
                "emotion_label": item.emotion_label,
                "mood_score": item.mood_score,
                "companion_note": item.companion_note,
                "composite_key": item.composite_key,
                "created_at": item.created_at.isoformat(),
            }
            for item in artifacts
        ],
    }


@router.delete("/data", status_code=status.HTTP_204_NO_CONTENT)
async def delete_data(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    user_id = current_user.id
    artifacts = list((await db.scalars(select(DiaryArtifact).where(DiaryArtifact.user_id == user_id))).all())
    artifact_ids = [artifact.id for artifact in artifacts]
    panels = list((await db.scalars(select(Panel).where(Panel.artifact_id.in_(artifact_ids)))).all()) if artifact_ids else []
    entries = list((await db.scalars(select(DiaryEntry).where(DiaryEntry.user_id == user_id))).all())
    for key in [
        *(artifact.composite_key for artifact in artifacts),
        *(key for artifact in artifacts for key in artifact.panel_keys_json),
        *(panel.image_key for panel in panels),
        *(entry.audio_key for entry in entries),
    ]:
        request.app.state.storage.delete(key)
    await db.execute(delete(PetSession).where(PetSession.user_id == user_id))
    await db.execute(delete(RateLimitCounter).where(RateLimitCounter.user_id == user_id))
    await db.execute(delete(MemoryItem).where(MemoryItem.user_id == user_id))
    await db.execute(delete(Character).where(Character.user_id == user_id))
    await db.execute(delete(DailyDiary).where(DailyDiary.user_id == user_id))
    await db.execute(delete(DiaryArtifact).where(DiaryArtifact.user_id == user_id))
    await db.execute(delete(DiaryEntry).where(DiaryEntry.user_id == user_id))
    await db.execute(delete(Job).where(Job.user_id == user_id))
    await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
    await db.delete(current_user)
    await db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("voonie_access", path="/")
    response.delete_cookie("voonie_refresh", path=f"{request.app.state.settings.API_PREFIX}/auth")
    return response
