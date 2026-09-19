from datetime import datetime, timedelta, timezone

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import RateLimitCounter


class RateLimiter:
    @staticmethod
    def _limit_error(now: datetime) -> ApiError:
        next_window = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        retry_after = max(1, int((next_window - now).total_seconds()))
        return ApiError(
            429,
            "rate_limit_exceeded",
            "Too many requests; retry next hour",
            headers={"Retry-After": str(retry_after)},
        )

    async def consume(
        self, db: AsyncSession, user_id: str, scope: str, limit: int, *, commit: bool = True
    ) -> None:
        if limit <= 0:
            raise self._limit_error(datetime.now(timezone.utc))
        now = datetime.now(timezone.utc)
        window_start = now.replace(minute=0, second=0, microsecond=0)
        changed = await db.execute(
            update(RateLimitCounter)
            .where(
                RateLimitCounter.user_id == user_id,
                RateLimitCounter.scope == scope,
                RateLimitCounter.window_start == window_start,
                RateLimitCounter.count < limit,
            )
            .values(count=RateLimitCounter.count + 1)
        )
        if changed.rowcount == 1:
            await (db.commit() if commit else db.flush())
            return
        counter = RateLimitCounter(
            user_id=user_id,
            scope=scope,
            window_start=window_start,
            count=1,
        )
        db.add(counter)
        try:
            await (db.commit() if commit else db.flush())
            return
        except IntegrityError:
            await db.rollback()
        changed = await db.execute(
            update(RateLimitCounter)
            .where(
                RateLimitCounter.user_id == user_id,
                RateLimitCounter.scope == scope,
                RateLimitCounter.window_start == window_start,
                RateLimitCounter.count < limit,
            )
            .values(count=RateLimitCounter.count + 1)
        )
        if changed.rowcount != 1:
            await db.rollback()
            raise self._limit_error(now)
        await (db.commit() if commit else db.flush())
