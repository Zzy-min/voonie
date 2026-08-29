from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.api.deps import get_current_user
from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import DiaryArtifact, Job, Panel, User
from voonie.backend.app.db.session import get_db
from voonie.backend.app.schemas.artifacts import ArtifactResponse, PanelResponse
from voonie.backend.app.schemas.jobs import JobQueuedResponse
from voonie.backend.app.workers.panel_retry_job import execute_panel_retry_job
import asyncio


router = APIRouter(tags=["Artifacts"])


def serialize_artifact(artifact: DiaryArtifact, panels: list[Panel], storage) -> ArtifactResponse:
    return ArtifactResponse(
        id=artifact.id,
        job_id=artifact.job_id,
        entry_id=artifact.entry_id,
        artifact_type=artifact.artifact_type,
        version=artifact.version,
        title=artifact.title,
        emotion_label=artifact.emotion_label,
        mood_score=artifact.mood_score,
        companion_note=artifact.companion_note,
        composite_url=storage.get_file_url(artifact.composite_key) if artifact.composite_key else None,
        character_snapshot=artifact.character_snapshot_json,
        panels=[
            PanelResponse(
                panel_no=panel.panel_no,
                status=panel.status,
                image_url=storage.get_file_url(panel.image_key) if panel.image_key else None,
                storyboard=panel.storyboard_json,
                retry_count=panel.retry_count,
            )
            for panel in panels
        ],
        created_at=artifact.created_at,
    )


async def owned_artifact(db: AsyncSession, artifact_id: str, user_id: str) -> DiaryArtifact:
    artifact = await db.scalar(
        select(DiaryArtifact).where(DiaryArtifact.id == artifact_id, DiaryArtifact.user_id == user_id)
    )
    if artifact is None:
        raise ApiError(404, "artifact_not_found", "Artifact not found")
    return artifact


@router.get("/artifacts/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
    artifact_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ArtifactResponse:
    artifact = await owned_artifact(db, artifact_id, current_user.id)
    panels = (await db.scalars(select(Panel).where(Panel.artifact_id == artifact.id).order_by(Panel.panel_no))).all()
    return serialize_artifact(artifact, list(panels), request.app.state.storage)


@router.post("/artifacts/{artifact_id}/panels/{panel_no}/retry", response_model=JobQueuedResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_panel(
    artifact_id: str,
    panel_no: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JobQueuedResponse:
    artifact = await owned_artifact(db, artifact_id, current_user.id)
    panel = await db.scalar(select(Panel).where(Panel.artifact_id == artifact.id, Panel.panel_no == panel_no))
    if panel is None:
        raise ApiError(404, "panel_not_found", "Panel not found")
    await request.app.state.rate_limiter.consume(
        db, current_user.id, "comic", request.app.state.settings.COMIC_HOURLY_LIMIT, commit=False
    )
    job = Job(
        user_id=current_user.id,
        type="panel_retry",
        request_json={"artifact_id": artifact.id, "panel_no": panel_no},
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    request.state.job_id = job.id
    context = {
        "session_factory": request.app.state.db_session_factory,
        "image_service": request.app.state.image_service,
        "composer": request.app.state.composer,
        "storage": request.app.state.storage,
    }
    if request.app.state.settings.ARQ_INLINE:
        task = asyncio.create_task(execute_panel_retry_job(context, job.id))
        request.app.state.inline_tasks.add(task)
        task.add_done_callback(request.app.state.inline_tasks.discard)
    else:
        if request.app.state.arq_pool is None:
            job.status = "failed"
            job.stage = "failed"
            job.error = "queue_unavailable"
            await db.commit()
            raise ApiError(503, "queue_unavailable", "Job queue is unavailable")
        try:
            enqueued = await request.app.state.arq_pool.enqueue_job("generate_panel_retry_job", job.id)
            if enqueued is None:
                raise RuntimeError("queue rejected job")
        except Exception as exc:
            job.status = "failed"
            job.stage = "failed"
            job.error = "queue_unavailable"
            await db.commit()
            raise ApiError(503, "queue_unavailable", "Job queue is unavailable") from exc
    return JobQueuedResponse(job_id=job.id)
