import asyncio
from datetime import date

from fastapi import APIRouter, Depends, Request, status
from fastapi import Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.core.timeutils import day_bounds
from voonie.backend.app.db.models import DailyDiary, DailyDiaryEntry, DiaryArtifact, DiaryEntry, Job, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.models.schemas import CharacterConfig
from voonie.backend.app.schemas.daily import DailyDiaryResponse, DailyDiaryUpdate, DailyJobQueued
from voonie.backend.app.workers.storybook_job import execute_storybook_job, page_count_for


router = APIRouter(prefix="/daily-diaries", tags=["Daily Diaries"])


async def confirmed_entries(db: AsyncSession, user_id: str, diary_date: date, timezone_name: str) -> list[DiaryEntry]:
    start, end = day_bounds(diary_date, timezone_name)
    rows = (
        await db.scalars(
            select(DiaryEntry)
            .where(
                DiaryEntry.user_id == user_id,
                DiaryEntry.status.in_(["confirmed", "draft"]),
                DiaryEntry.entry_date.between(start, end),
            )
            .order_by(DiaryEntry.entry_date.asc(), DiaryEntry.created_at.asc())
        )
    ).all()
    return [row for row in rows if row.status == "confirmed" and row.redacted_text]


async def get_or_create_daily(
    db: AsyncSession, user_id: str, diary_date: date, timezone_name: str
) -> DailyDiary:
    existing = await db.scalar(
        select(DailyDiary).where(
            DailyDiary.user_id == user_id,
            DailyDiary.diary_date == diary_date.isoformat(),
            DailyDiary.timezone == timezone_name,
        )
    )
    if existing is not None:
        return existing
    daily = DailyDiary(
        user_id=user_id,
        diary_date=diary_date.isoformat(),
        timezone=timezone_name,
        status="draft",
        emotion_arc_json=[],
    )
    db.add(daily)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(DailyDiary).where(
                DailyDiary.user_id == user_id,
                DailyDiary.diary_date == diary_date.isoformat(),
                DailyDiary.timezone == timezone_name,
            )
        )
        if existing is None:
            raise
        return existing
    await db.refresh(daily)
    return daily


async def serialize_daily(db: AsyncSession, daily: DailyDiary) -> DailyDiaryResponse:
    links = (
        await db.scalars(
            select(DailyDiaryEntry)
            .where(DailyDiaryEntry.daily_diary_id == daily.id)
            .order_by(DailyDiaryEntry.position.asc())
        )
    ).all()
    latest = await db.scalar(
        select(DiaryArtifact)
        .where(DiaryArtifact.daily_diary_id == daily.id)
        .order_by(DiaryArtifact.version.desc())
    )
    return DailyDiaryResponse(
        id=daily.id,
        diary_date=daily.diary_date,
        timezone=daily.timezone,
        status=daily.status,
        title=daily.title,
        summary=daily.summary,
        emotion_arc=daily.emotion_arc_json,
        entry_ids=[item.entry_id for item in links],
        generation_version=daily.generation_version,
        latest_artifact_id=latest.id if latest else None,
    )


@router.get("/{diary_date}", response_model=DailyDiaryResponse)
async def get_daily_diary(
    diary_date: date,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    timezone_name: str = Query(default="UTC", alias="timezone"),
) -> DailyDiaryResponse:
    daily = await get_or_create_daily(db, current_user.id, diary_date, timezone_name)
    return await serialize_daily(db, daily)


@router.post("/{diary_date}/summary-jobs", response_model=DailyDiaryResponse)
async def create_summary(
    diary_date: date,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    timezone_name: str = Query(default="UTC", alias="timezone"),
) -> DailyDiaryResponse:
    entries = await confirmed_entries(db, current_user.id, diary_date, timezone_name)
    daily = await get_or_create_daily(db, current_user.id, diary_date, timezone_name)
    if not entries:
        daily.status = "draft"
        daily.summary = None
        daily.emotion_arc_json = []
        await db.commit()
        return await serialize_daily(db, daily)
    text = "\n".join(item.redacted_text for item in entries)
    analysis = await request.app.state.diary_analyzer.analyze(text)
    daily.summary = analysis.summary
    daily.title = analysis.summary[:40]
    daily.emotion_arc_json = [analysis.emotion.label]
    daily.status = "ready"
    existing_links = (
        await db.scalars(select(DailyDiaryEntry).where(DailyDiaryEntry.daily_diary_id == daily.id))
    ).all()
    for link in existing_links:
        await db.delete(link)
    for index, entry in enumerate(entries, start=1):
        db.add(DailyDiaryEntry(daily_diary_id=daily.id, entry_id=entry.id, position=index))
    await db.commit()
    return await serialize_daily(db, daily)


@router.patch("/{diary_date}", response_model=DailyDiaryResponse)
async def update_daily(
    diary_date: date,
    body: DailyDiaryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    timezone_name: str = Query(default="UTC", alias="timezone"),
) -> DailyDiaryResponse:
    daily = await get_or_create_daily(db, current_user.id, diary_date, timezone_name)
    if body.title is not None:
        daily.title = body.title
    if body.summary is not None:
        daily.summary = body.summary
        daily.status = "ready"
    await db.commit()
    return await serialize_daily(db, daily)


@router.post("/{diary_date}/storybook-jobs", response_model=DailyJobQueued, status_code=status.HTTP_202_ACCEPTED)
async def create_storybook_job(
    diary_date: date,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    timezone_name: str = Query(default="UTC", alias="timezone"),
) -> DailyJobQueued:
    daily = await get_or_create_daily(db, current_user.id, diary_date, timezone_name)
    if not daily.summary:
        raise ApiError(409, "summary_required", "Confirm the daily summary before generating a storybook")
    entries = await confirmed_entries(db, current_user.id, diary_date, timezone_name)
    count = page_count_for(len(entries))
    if count == 0:
        raise ApiError(409, "empty_day", "No confirmed diary entries for this date")
    await request.app.state.rate_limiter.consume(
        db, current_user.id, "comic", request.app.state.settings.COMIC_HOURLY_LIMIT, commit=False
    )
    daily.status = "generating"
    job = Job(
        user_id=current_user.id,
        type="storybook",
        request_json={
            "daily_diary_id": daily.id,
            "page_count": count,
            "character": CharacterConfig().model_dump(mode="json"),
        },
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    request.state.job_id = job.id
    context = {
        "session_factory": request.app.state.db_session_factory,
        "storyboard_agent": request.app.state.storyboard_agent,
        "image_service": request.app.state.image_service,
        "composer": request.app.state.composer,
        "storage": request.app.state.storage,
    }
    if request.app.state.settings.ARQ_INLINE:
        task = asyncio.create_task(execute_storybook_job(context, job.id))
        request.app.state.inline_tasks.add(task)
        task.add_done_callback(request.app.state.inline_tasks.discard)
    else:
        if request.app.state.arq_pool is None:
            job.status = "failed"
            job.stage = "failed"
            job.error = "queue_unavailable"
            daily.status = "ready"
            await db.commit()
            raise ApiError(503, "queue_unavailable", "Job queue is unavailable")
        try:
            enqueued = await request.app.state.arq_pool.enqueue_job("generate_storybook_job", job.id)
            if enqueued is None:
                raise RuntimeError("queue rejected job")
        except Exception as exc:
            job.status = "failed"
            job.stage = "failed"
            job.error = "queue_unavailable"
            daily.status = "ready"
            await db.commit()
            raise ApiError(503, "queue_unavailable", "Job queue is unavailable") from exc
    return DailyJobQueued(job_id=job.id)
