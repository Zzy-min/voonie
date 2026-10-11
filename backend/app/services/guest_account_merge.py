"""Move a proved guest's private records into an existing WeChat account."""

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import (
    Character, DailyDiary, DiaryArtifact, DiaryEntry, DiaryReference, Feedback,
    Job, MemoryItem, PetSession, RateLimitCounter, SharePost, ShareReaction,
    ShareReport, User,
)


async def merge_guest_account(db: AsyncSession, guest: User, owner: User) -> None:
    if guest.id == owner.id:
        return
    if guest.wechat_openid:
        raise ApiError(409, "wechat_already_bound", "当前账号已绑定其他微信账号")
    active = await db.scalar(select(func.count()).select_from(Job).where(
        Job.user_id == guest.id, Job.status.in_(("queued", "running")),
    )) or 0
    if active:
        raise ApiError(409, "guest_generation_in_progress", "请等待游客日记生成完成后再登录微信")
    if guest.email and owner.email and guest.email != owner.email:
        raise ApiError(409, "account_merge_email_conflict", "两个账号分别绑定了邮箱，请先联系支持处理合并")
    if guest.phone and owner.phone and guest.phone != owner.phone:
        raise ApiError(409, "account_merge_phone_conflict", "两个账号分别绑定了手机号，请先联系支持处理合并")

    guest_daily = await db.execute(select(DailyDiary.diary_date, DailyDiary.timezone).where(DailyDiary.user_id == guest.id))
    for diary_date, timezone_name in guest_daily:
        conflict = await db.scalar(select(DailyDiary.id).where(
            DailyDiary.user_id == owner.id,
            DailyDiary.diary_date == diary_date,
            DailyDiary.timezone == timezone_name,
        ))
        if conflict:
            raise ApiError(409, "account_merge_daily_conflict", "两个账号同一天都有日记，请先联系支持处理合并")

    # Preserve both users' entries and retry history even when their client
    # generated local or idempotency keys happen to be identical.
    jobs = await db.scalars(select(Job).where(Job.user_id == guest.id))
    for job in jobs:
        job.idempotency_key = f"merged-guest-{job.id}"
    entries = await db.scalars(select(DiaryEntry).where(DiaryEntry.user_id == guest.id))
    for entry in entries:
        entry.local_id = f"merged-guest-{entry.id}"
    await db.flush()

    for model in (
        Character, Job, DiaryEntry, DiaryReference, DailyDiary, DiaryArtifact,
        MemoryItem, PetSession, Feedback, SharePost, ShareReaction,
    ):
        await db.execute(update(model).where(model.user_id == guest.id).values(user_id=owner.id))
    await db.execute(update(ShareReport).where(ShareReport.reporter_user_id == guest.id).values(reporter_user_id=owner.id))
    await db.execute(delete(RateLimitCounter).where(RateLimitCounter.user_id == guest.id))

    email_to_transfer = guest.email if guest.email and not owner.email else None
    password_to_transfer = guest.password_hash if email_to_transfer else None
    phone_to_transfer = guest.phone if guest.phone and not owner.phone else None
    await db.execute(delete(User).where(User.id == guest.id))
    if email_to_transfer:
        owner.email = email_to_transfer
        owner.password_hash = password_to_transfer
    if phone_to_transfer:
        owner.phone = phone_to_transfer
    await db.flush()
