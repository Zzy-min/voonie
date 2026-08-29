import asyncio
from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from voonie.backend.app.db.models import Job, User


EXPECTED_TABLES = {
    "alembic_version",
    "characters",
    "character_references",
    "diary_entries",
    "diary_artifacts",
    "daily_diaries",
    "daily_diary_entries",
    "jobs",
    "memory_items",
    "pet_sessions",
    "panels",
    "refresh_tokens",
    "users",
}


def alembic_config(database_url: str) -> Config:
    config = Config("voonie/backend/alembic.ini")
    config.set_main_option("script_location", "voonie/backend/alembic")
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_initial_migration_creates_schema_and_persists_user_job():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    database_path = data_dir / f"migrated-{uuid.uuid4().hex}.db"
    sync_url = f"sqlite:///{database_path.as_posix()}"
    async_url = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    config = alembic_config(sync_url)

    command.upgrade(config, "head")

    async def exercise_database():
        engine = create_async_engine(async_url)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda sync_connection: set(inspect(sync_connection).get_table_names()))
        assert EXPECTED_TABLES <= tables

        async with session_factory() as session:
            user = User(device_id="device-test-001")
            session.add(user)
            await session.flush()
            job = Job(user_id=user.id, type="comic", request_json={"text": "hello"})
            session.add(job)
            await session.commit()

        async with session_factory() as session:
            stored = await session.scalar(select(Job).where(Job.id == job.id))
            assert stored is not None
            assert stored.user_id == user.id
            assert stored.status == "queued"
            assert stored.request_json == {"text": "hello"}
        await engine.dispose()

    asyncio.run(exercise_database())

    command.downgrade(config, "base")
    engine = create_async_engine(async_url)

    async def assert_downgraded():
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda sync_connection: set(inspect(sync_connection).get_table_names()))
        assert not (EXPECTED_TABLES - {"alembic_version"}) & tables
        await engine.dispose()

    asyncio.run(assert_downgraded())
    database_path.unlink()
