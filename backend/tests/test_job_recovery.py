import asyncio
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from voonie.backend.app.db.models import Base, DailyDiary, Job, User
from voonie.backend.app.services.job_recovery import recover_interrupted_jobs


def test_startup_recovery_marks_interrupted_jobs_retryable_and_restores_daily_diary(tmp_path):
    database_url = f"sqlite+aiosqlite:///{(tmp_path / 'recovery.db').as_posix()}"

    async def exercise():
        engine = create_async_engine(database_url)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as session:
            user = User(device_id="recovery-device")
            session.add(user)
            await session.flush()
            running = Job(
                user_id=user.id,
                type="comic",
                status="running",
                stage="rendering",
                progress=0.5,
                request_json={"entry_id": "entry-1"},
                idempotency_key="restart-safe-job",
            )
            queued = Job(
                user_id=user.id,
                type="comic",
                status="queued",
                stage="queued",
                request_json={"entry_id": "entry-2"},
            )
            done = Job(
                user_id=user.id,
                type="comic",
                status="done",
                stage="done",
                progress=1,
                request_json={"entry_id": "entry-3"},
            )
            daily = DailyDiary(
                user_id=user.id,
                diary_date="2026-09-19",
                timezone="Asia/Shanghai",
                status="generating",
            )
            session.add_all([running, queued, done, daily])
            await session.commit()
            running_id, queued_id, done_id, daily_id = running.id, queued.id, done.id, daily.id

        recovered = await recover_interrupted_jobs(session_factory)
        assert recovered == 2

        async with session_factory() as session:
            recovered_job = await session.get(Job, running_id)
            assert recovered_job.status == "failed"
            assert recovered_job.stage == "failed"
            assert recovered_job.error == "worker_interrupted"
            assert recovered_job.finished_at is not None
            assert (await session.get(Job, queued_id)).status == "failed"
            assert (await session.get(Job, done_id)).status == "done"
            assert (await session.get(DailyDiary, daily_id)).status == "ready"

            interrupted = list((await session.scalars(
                select(Job).where(Job.error == "worker_interrupted")
            )).all())
            assert {item.id for item in interrupted} == {running_id, queued_id}

        await engine.dispose()

    asyncio.run(exercise())
