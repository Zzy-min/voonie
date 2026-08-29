import asyncio
from pathlib import Path
import uuid

import pytest
from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base
from voonie.backend.app.main import create_app


@pytest.fixture
def me_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    database_path = data_dir / f"me-{uuid.uuid4().hex}.db"
    app = create_app(Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="me-test-secret-that-is-long-enough",
        ARQ_INLINE=True,
        TESTING=False,
    ))

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    with TestClient(app) as client:
        yield client
    asyncio.run(app.state.db_engine.dispose())
    database_path.unlink(missing_ok=True)


def auth_headers(client: TestClient, device: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/device", json={"device_id": device, "app_version": "1.0.0"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_preferences_export_and_delete(me_client):
    headers = auth_headers(me_client, "me-device-001")
    updated = me_client.patch("/api/v1/me/preferences", headers=headers, json={
        "nickname": "晚霞",
        "memory_opt_in": True,
    })
    assert updated.status_code == 200
    assert updated.json()["nickname"] == "晚霞"
    assert updated.json()["memory_opt_in"] is True
    exported = me_client.post("/api/v1/me/export", headers=headers)
    assert exported.status_code == 200
    assert exported.json()["user"]["nickname"] == "晚霞"
    deleted = me_client.delete("/api/v1/me/data", headers=headers)
    assert deleted.status_code == 204
    assert me_client.get("/api/v1/me/preferences", headers=headers).status_code == 401
