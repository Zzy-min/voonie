import asyncio
import json

from fastapi import APIRouter, Depends, Header, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import DailyDiary, Job, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.jobs import ComicJobRequest, JobQueuedResponse, JobStatusResponse
from voonie.backend.app.workers.comic_job import run_inline_comic_job


router = APIRouter(prefix="/jobs", tags=["Jobs"])


def serialize_job(job: Job) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=job.id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        error=job.error,
        result=job.result_json,
        created_at=job.created_at,
        updated_at=job.updated_at,
        finished_at=job.finished_at,
    )


async def owned_job(db: AsyncSession, job_id: str, user_id: str) -> Job:
    job = await db.scalar(select(Job).where(Job.id == job_id, Job.user_id == user_id))
    if job is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "job_not_found", "Job not found")
    return job


async def enqueue_comic_job(
    request: Request,
    db: AsyncSession,
    current_user: User,
    payload: dict,
    idempotency_key: str | None,
) -> JobQueuedResponse:
    if idempotency_key:
        existing = await db.scalar(
            select(Job).where(Job.user_id == current_user.id, Job.idempotency_key == idempotency_key)
        )
        if existing is not None:
            return JobQueuedResponse(job_id=existing.id)
    await request.app.state.rate_limiter.consume(
        db,
        current_user.id,
        "comic",
        request.app.state.settings.COMIC_HOURLY_LIMIT,
        commit=False,
    )
    job = Job(user_id=current_user.id, type="comic", request_json=payload, idempotency_key=idempotency_key)
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not idempotency_key:
            raise
        existing = await db.scalar(
            select(Job).where(Job.user_id == current_user.id, Job.idempotency_key == idempotency_key)
        )
        if existing is None:
            raise
        return JobQueuedResponse(job_id=existing.id)
    await db.refresh(job)
    request.state.job_id = job.id
    if request.app.state.settings.ARQ_INLINE:
        context = {
            "session_factory": request.app.state.db_session_factory,
            "storyboard_agent": request.app.state.storyboard_agent,
            "image_service": request.app.state.image_service,
            "composer": request.app.state.composer,
            "storage": request.app.state.storage,
            "embedding_provider": request.app.state.embedding_provider,
        }
        task = asyncio.create_task(run_inline_comic_job(context, job.id))
        request.app.state.inline_tasks.add(task)
        task.add_done_callback(request.app.state.inline_tasks.discard)
    else:
        if request.app.state.arq_pool is None:
            job.status = "failed"
            job.stage = "failed"
            job.error = "queue_unavailable"
            await db.commit()
            raise ApiError(status.HTTP_503_SERVICE_UNAVAILABLE, "queue_unavailable", "Job queue is unavailable")
        try:
            enqueued = await request.app.state.arq_pool.enqueue_job("generate_comic_job", job.id)
            if enqueued is None:
                raise RuntimeError("queue rejected job")
        except Exception as exc:
            job.status = "failed"
            job.stage = "failed"
            job.error = "queue_unavailable"
            await db.commit()
            raise ApiError(
                status.HTTP_503_SERVICE_UNAVAILABLE, "queue_unavailable", "Job queue is unavailable"
            ) from exc
    return JobQueuedResponse(job_id=job.id)


@router.post("/comic", response_model=JobQueuedResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_comic_job(
    body: ComicJobRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=255),
) -> JobQueuedResponse:
    return await enqueue_comic_job(
        request, db, current_user, body.model_dump(mode="json"), idempotency_key
    )


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobStatusResponse:
    return serialize_job(await owned_job(db, job_id, current_user.id))


@router.post("/{job_id}/cancel", response_model=JobStatusResponse)
async def cancel_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobStatusResponse:
    user_id = current_user.id
    job = await owned_job(db, job_id, user_id)
    if job.status in {"done", "failed", "cancelled"}:
        return serialize_job(job)
    cancelled = await db.execute(
        update(Job)
        .where(Job.id == job_id, Job.user_id == user_id, Job.status.in_(("queued", "running")))
        .values(status="cancelled", stage="cancelled", error="cancelled_by_user")
    )
    if cancelled.rowcount == 1 and job.type == "storybook":
        daily_id = (job.request_json or {}).get("daily_diary_id")
        if daily_id:
            await db.execute(
                update(DailyDiary)
                .where(
                    DailyDiary.id == daily_id,
                    DailyDiary.user_id == user_id,
                    DailyDiary.status == "generating",
                )
                .values(status="ready")
            )
    await db.commit()
    db.expire_all()
    return serialize_job(await owned_job(db, job_id, user_id))


@router.get("/{job_id}/events")
async def job_events(
    job_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await owned_job(db, job_id, current_user.id)

    async def event_stream():
        previous = None
        while True:
            async with request.app.state.db_session_factory() as event_session:
                job = await event_session.scalar(
                    select(Job).where(Job.id == job_id, Job.user_id == current_user.id)
                )
                if job is None:
                    return
                state = (job.status, job.stage, job.progress, job.error)
                if state != previous:
                    event_name = job.status if job.status in {"done", "failed", "cancelled"} else job.stage
                    payload = serialize_job(job).model_dump(mode="json")
                    yield f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    previous = state
                if job.status in {"done", "failed", "cancelled"} or await request.is_disconnected():
                    return
            await asyncio.sleep(0.25)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
