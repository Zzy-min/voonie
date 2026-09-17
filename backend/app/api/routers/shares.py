from pathlib import Path

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import DiaryArtifact, Panel, SharePost, ShareReaction, ShareReport, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.shares import (
    ReactionResponse, SharePostResponse, ShareReportCreate, ShareReportResponse,
    ShareUpsert, ShareVisibilityUpdate,
)


router = APIRouter(prefix="/shares", tags=["Shares"])


async def serialize(post: SharePost, viewer_id: str, db: AsyncSession) -> SharePostResponse:
    artifact = await db.get(DiaryArtifact, post.artifact_id)
    author = await db.get(User, post.user_id)
    panel = await db.scalar(select(Panel).where(Panel.artifact_id == post.artifact_id).order_by(Panel.panel_no))
    counts = dict((await db.execute(
        select(ShareReaction.kind, func.count()).where(ShareReaction.post_id == post.id).group_by(ShareReaction.kind)
    )).all())
    mine = set((await db.scalars(select(ShareReaction.kind).where(
        ShareReaction.post_id == post.id, ShareReaction.user_id == viewer_id
    ))).all())
    image_url = f"/api/v1/shares/{post.id}/media/{panel.image_key.rsplit('/', 1)[-1]}" if panel and panel.image_key else None
    return SharePostResponse(
        id=post.id, artifact_id=post.artifact_id, author=author.nickname if author else "小主人",
        caption=post.caption, tags=post.tags_json, mood=artifact.emotion_label if artifact else "平静",
        image_url=image_url, is_public=post.is_public, hide_date=post.hide_date,
        created_at=post.created_at, likes=counts.get("like", 0), collects=counts.get("collect", 0),
        is_liked="like" in mine, is_collected="collect" in mine,
        is_owner=post.user_id == viewer_id,
    )


@router.post("", response_model=SharePostResponse, status_code=status.HTTP_201_CREATED)
async def upsert_share(payload: ShareUpsert, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    artifact = await db.scalar(select(DiaryArtifact).where(
        DiaryArtifact.job_id == payload.artifact_id, DiaryArtifact.user_id == current_user.id
    ))
    if artifact is None:
        raise ApiError(404, "diary_not_found", "Diary not found")
    post = await db.scalar(select(SharePost).where(
        SharePost.user_id == current_user.id, SharePost.artifact_id == artifact.id
    ))
    if post is None:
        post = SharePost(user_id=current_user.id, artifact_id=artifact.id, caption=payload.caption)
        db.add(post)
    post.caption = payload.caption.strip()
    post.tags_json = [tag.strip()[:30] for tag in payload.tags if tag.strip()][:10]
    post.show_location = payload.show_location
    post.hide_date = payload.hide_date
    post.is_public = payload.is_public
    await db.commit()
    await db.refresh(post)
    return await serialize(post, current_user.id, db)


@router.get("", response_model=list[SharePostResponse])
async def list_shares(order: str = "recommend", current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    query = select(SharePost).where(SharePost.is_public.is_(True))
    query = query.order_by(SharePost.created_at.desc())
    posts = list((await db.scalars(query.limit(50))).all())
    items = [await serialize(post, current_user.id, db) for post in posts]
    if order == "recommend":
        items.sort(key=lambda item: (item.likes + item.collects * 2, item.created_at), reverse=True)
    return items


@router.patch("/{post_id}", response_model=SharePostResponse)
async def update_share_visibility(payload: ShareVisibilityUpdate, post_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    post = await db.scalar(select(SharePost).where(SharePost.id == post_id, SharePost.user_id == current_user.id))
    if post is None:
        raise ApiError(404, "share_not_found", "Share not found")
    post.is_public = payload.is_public
    await db.commit()
    await db.refresh(post)
    return await serialize(post, current_user.id, db)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_share(post_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    post = await db.scalar(select(SharePost).where(SharePost.id == post_id, SharePost.user_id == current_user.id))
    if post is None:
        raise ApiError(404, "share_not_found", "Share not found")
    await db.execute(delete(ShareReaction).where(ShareReaction.post_id == post.id))
    await db.execute(delete(ShareReport).where(ShareReport.post_id == post.id))
    await db.delete(post)
    await db.commit()


@router.post("/{post_id}/reports", response_model=ShareReportResponse, status_code=status.HTTP_201_CREATED)
async def report_share(payload: ShareReportCreate, post_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    post = await db.scalar(select(SharePost).where(SharePost.id == post_id, SharePost.is_public.is_(True)))
    if post is None:
        raise ApiError(404, "share_not_found", "Share not found")
    reason = payload.reason.strip()
    existing = await db.scalar(select(ShareReport).where(
        ShareReport.reporter_user_id == current_user.id, ShareReport.post_id == post_id, ShareReport.reason == reason
    ))
    if existing is None:
        db.add(ShareReport(reporter_user_id=current_user.id, post_id=post_id, reason=reason,
                           detail=payload.detail.strip() if payload.detail else None))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
    return ShareReportResponse(submitted=True)


@router.get("/{post_id}/media/{filename}")
async def public_share_media(post_id: str, filename: str, request: Request, db: AsyncSession = Depends(get_db)):
    if Path(filename).name != filename:
        raise ApiError(404, "media_not_found", "Media not found")
    post = await db.scalar(select(SharePost).where(SharePost.id == post_id, SharePost.is_public.is_(True)))
    if post is None:
        raise ApiError(404, "media_not_found", "Media not found")
    keys = (await db.scalars(select(Panel.image_key).where(Panel.artifact_id == post.artifact_id))).all()
    matched = next((key for key in keys if key and Path(key).name == filename), None)
    media_path = request.app.state.settings.TEMP_MEDIA_DIR / filename
    if matched is None or not media_path.is_file():
        raise ApiError(404, "media_not_found", "Media not found")
    return FileResponse(str(media_path))


@router.put("/{post_id}/reactions/{kind}", response_model=ReactionResponse)
async def toggle_reaction(post_id: str, kind: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if kind not in {"like", "collect"}:
        raise ApiError(422, "invalid_reaction", "Reaction must be like or collect")
    post = await db.scalar(select(SharePost).where(SharePost.id == post_id, SharePost.is_public.is_(True)))
    if post is None:
        raise ApiError(404, "share_not_found", "Share not found")
    reaction = await db.scalar(select(ShareReaction).where(
        ShareReaction.post_id == post_id, ShareReaction.user_id == current_user.id, ShareReaction.kind == kind
    ))
    active = reaction is None
    if reaction is None:
        db.add(ShareReaction(post_id=post_id, user_id=current_user.id, kind=kind))
    else:
        await db.delete(reaction)
    await db.commit()
    count = await db.scalar(select(func.count()).select_from(ShareReaction).where(
        ShareReaction.post_id == post_id, ShareReaction.kind == kind
    ))
    return ReactionResponse(active=active, count=count or 0)
