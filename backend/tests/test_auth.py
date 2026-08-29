import asyncio
from pathlib import Path
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, User
from voonie.backend.app.main import create_app


@pytest.fixture
def auth_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    database_path = data_dir / f"auth-{uuid.uuid4().hex}.db"
    settings = Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="test-secret-that-is-long-enough-for-hs256",
        ARQ_INLINE=True,
        TESTING=False,
    )
    app = create_app(settings)

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    with TestClient(app) as client:
        yield client
    asyncio.run(app.state.db_engine.dispose())
    for _ in range(20):
        try:
            database_path.unlink(missing_ok=True)
            break
        except PermissionError:
            time.sleep(0.05)


def register_device(client: TestClient, device_id: str = "device-auth-001") -> dict:
    response = client.post(
        "/api/v1/auth/device",
        json={"device_id": device_id, "app_version": "1.0.0"},
    )
    assert response.status_code == 201
    return response.json()


def test_diaries_requires_access_token(auth_client):
    response = auth_client.get("/api/v1/diaries")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_invalid_access_token_is_rejected(auth_client):
    response = auth_client.get(
        "/api/v1/diaries",
        headers={"Authorization": "Bearer not-a-token"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


def test_device_registration_is_idempotent_and_access_token_authenticates(auth_client):
    first = register_device(auth_client)
    second = register_device(auth_client)

    assert first["user_id"] == second["user_id"]
    assert first["token_type"] == "bearer"
    response = auth_client.get(
        "/api/v1/diaries",
        headers={"Authorization": f"Bearer {first['access_token']}"},
    )
    assert response.status_code == 200


def test_existing_device_requires_installation_proof(auth_client):
    first = register_device(auth_client, "device-proof-001")
    device_secret = first["device_secret"]
    assert device_secret
    auth_client.cookies.clear()

    takeover = auth_client.post(
        "/api/v1/auth/device",
        json={"device_id": "device-proof-001", "app_version": "1.0.0"},
    )
    assert takeover.status_code == 401
    assert takeover.json()["error"]["code"] == "device_proof_required"

    proven = auth_client.post(
        "/api/v1/auth/device",
        json={"device_id": "device-proof-001", "app_version": "1.0.0", "device_secret": device_secret},
    )
    assert proven.status_code == 201
    assert proven.json()["user_id"] == first["user_id"]
    assert proven.json()["device_secret"] is None


def test_legacy_mobile_device_can_migrate_with_bearer_proof(auth_client):
    first = register_device(auth_client, "device-legacy-mobile-001")

    async def make_legacy():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.get(User, first["user_id"])
            user.device_secret_hash = None
            await session.commit()

    asyncio.run(make_legacy())
    auth_client.cookies.clear()
    migrated = auth_client.post(
        "/api/v1/auth/device",
        headers={"Authorization": f"Bearer {first['access_token']}"},
        json={"device_id": "device-legacy-mobile-001", "app_version": "flutter-legacy"},
    )
    assert migrated.status_code == 201
    assert migrated.json()["device_secret"]


def test_web_session_uses_http_only_cookies(auth_client):
    response = auth_client.post(
        "/api/v1/auth/device",
        json={"device_id": "device-cookie-001", "app_version": "web-v2"},
    )

    cookies = response.headers.get_list("set-cookie")
    assert any("voonie_access=" in cookie and "HttpOnly" in cookie for cookie in cookies)
    assert any("voonie_refresh=" in cookie and "HttpOnly" in cookie for cookie in cookies)
    assert auth_client.get("/api/v1/diaries").status_code == 200
    refreshed = auth_client.post("/api/v1/auth/refresh", json={})
    assert refreshed.status_code == 200


def test_refresh_token_is_rotated_and_cannot_be_reused(auth_client):
    registered = register_device(auth_client, "device-refresh-001")

    refreshed = auth_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": registered["refresh_token"]},
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != registered["refresh_token"]

    replay = auth_client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": registered["refresh_token"]},
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "invalid_refresh_token"


def test_refresh_token_cannot_be_used_as_access_token(auth_client):
    registered = register_device(auth_client, "device-token-type-001")

    response = auth_client.get(
        "/api/v1/diaries",
        headers={"Authorization": f"Bearer {registered['refresh_token']}"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_token"


def test_logout_revokes_previously_issued_access_token(auth_client):
    registered = register_device(auth_client, "device-logout-revocation-001")
    access_token = registered["access_token"]
    auth_client.cookies.clear()

    logout = auth_client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {access_token}"},
        json={},
    )
    reused = auth_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert logout.status_code == 200
    assert reused.status_code == 401
    assert reused.json()["error"]["code"] == "invalid_token"


def test_repeated_failed_logins_are_rate_limited_without_blocking_correct_password(auth_client):
    auth_client.app.state.settings.LOGIN_FAILED_HOURLY_LIMIT = 2
    registration = auth_client.post("/api/v1/auth/register", json={
        "email": "rate-limit@example.com",
        "password": "correct-password",
        "confirm_password": "correct-password",
        "nickname": "限流测试",
    })
    assert registration.status_code == 201

    first = auth_client.post("/api/v1/auth/login", json={
        "email": "rate-limit@example.com", "password": "wrong-password",
    })
    second = auth_client.post("/api/v1/auth/login", json={
        "email": "rate-limit@example.com", "password": "wrong-password",
    })
    third = auth_client.post("/api/v1/auth/login", json={
        "email": "rate-limit@example.com", "password": "wrong-password",
    })
    correct = auth_client.post("/api/v1/auth/login", json={
        "email": "rate-limit@example.com", "password": "correct-password",
    })

    assert first.status_code == 401
    assert second.status_code == 401
    assert third.status_code == 429
    assert correct.status_code == 200


def test_production_settings_reject_insecure_or_mock_configuration():
    with pytest.raises(ValueError):
        Settings(PRODUCTION=True)

    configured = Settings(
        PRODUCTION=True,
        JWT_SECRET="unique-production-secret-that-is-at-least-32-chars",
        COOKIE_SECURE=True,
        OPENAI_API_KEY="configured-outside-source-control",
    )
    assert configured.PRODUCTION is True
