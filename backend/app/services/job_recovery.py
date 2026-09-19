from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from voonie.backend.app.db.models import DailyDiary, Job


async def recover_interrupted_jobs(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    include_queued: bool = True,
) -> int:
    """Move orphaned inline jobs to a retryable terminal state after restart."""

    interrupted_statuses = ["running"]
    if include_queued:
        interrupted_statuses.append("queued")
    now = datetime.now(timezone.utc)
    async with session_factory() as session:
        result = await session.execute(
            update(Job)
            .where(Job.status.in_(interrupted_statuses))
            .values(
                status="failed",
                stage="failed",
                error="worker_interrupted",
                finished_at=now,
            )
        )
        await session.execute(
            update(DailyDiary)
            .where(DailyDiary.status == "generating")
            .values(status="ready")
        )
        await session.commit()
        return int(result.rowcount or 0)
