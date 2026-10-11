"""Atomic admission control for the two successful guest diaries."""

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import Job, User


GUEST_GENERATION_LIMIT = 2
GUEST_GENERATION_JOB_TYPES = ("comic", "storybook")


async def require_guest_generation_slot(db: AsyncSession, user: User) -> None:
    if user.wechat_openid:
        return
    # This write serializes competing requests for the same guest account.
    # It also works on SQLite, where SELECT FOR UPDATE is ignored.
    await db.execute(
        update(User).where(User.id == user.id)
        .values(guest_generated_count=User.guest_generated_count)
    )
    completed = await db.scalar(select(User.guest_generated_count).where(User.id == user.id)) or 0
    active = await db.scalar(
        select(func.count()).select_from(Job).where(
            Job.user_id == user.id,
            Job.type.in_(GUEST_GENERATION_JOB_TYPES),
            Job.status.in_(("queued", "running")),
        )
    ) or 0
    if completed + active >= GUEST_GENERATION_LIMIT:
        raise ApiError(403, "wechat_login_required_after_trial", "已体验两篇日记，请登录微信后继续生成")
