import asyncio
from pathlib import Path
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, Feedback
from voonie.backend.app.main import create_app


def test_feedback_stores_allowlisted_diagnostics_without_diary_content():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    test_id = uuid.uuid4().hex
    database_path = data_dir / f"feedback-{test_id}.db"
    media_dir = data_dir / f"feedback-media-{test_id}"
    app = create_app(Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="feedback-test-secret-that-is-long-enough",
        TEMP_MEDIA_DIR=media_dir,
        ARQ_INLINE=True,
        TESTING=False,
    ))

    async def prepare():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(prepare())
    try:
        with TestClient(app) as client:
            token = client.post("/api/v1/auth/device", json={"device_id": "feedback-device-001", "app_version": "1.0.0"}).json()["access_token"]
            response = client.post("/api/v1/feedback", headers={"Authorization": f"Bearer {token}"}, json={
                "category": "bug",
                "description": "日历返回后位置发生变化",
                "device": {"model": "test-phone"},
                "diagnostics": {"requestId": "req-1", "currentPage": "pages/calendar/index", "diaryText": "private"},
            })
            assert response.status_code == 201

        async def load_feedback():
            async with app.state.db_session_factory() as session:
                return await session.scalar(select(Feedback))

        saved = asyncio.run(load_feedback())
        assert saved is not None
        assert saved.diagnostics_json == {"requestId": "req-1", "currentPage": "pages/calendar/index"}
        assert "private" not in str(saved.diagnostics_json)
    finally:
        asyncio.run(app.state.db_engine.dispose())
        database_path.unlink(missing_ok=True)
