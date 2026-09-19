import asyncio
from pathlib import Path
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, User
from voonie.backend.app.main import create_app


@pytest.fixture
def auth_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    database_path = data_dir / f"auth-{uuid.uuid4().hex}.db"
    settings = Settings(
        _env_file=None,
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="test-secret-that-is-long-enough-for-hs256",
        ARQ_INLINE=True,
        TESTING=False,
        REQUIRE_WECHAT_BINDING=True,
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


def test_device_registration_requires_wechat_before_product_data(auth_client):
    first = register_device(auth_client)
    second = register_device(auth_client)

    assert first["user_id"] == second["user_id"]
    assert first["token_type"] == "bearer"
    response = auth_client.get(
        "/api/v1/diaries",
        headers={"Authorization": f"Bearer {first['access_token']}"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "wechat_binding_required"
    identity = auth_client.get(
        "/api/v1/auth/identities",
        headers={"Authorization": f"Bearer {first['access_token']}"},
    )
    assert identity.status_code == 200
    assert identity.json()["wechat_bound"] is False


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
    blocked = auth_client.get("/api/v1/diaries")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "wechat_binding_required"
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


def test_registration_normalizes_email_hashes_password_and_rejects_duplicates(auth_client):
    password = "S3cure-密码-🌟"
    first = auth_client.post("/api/v1/auth/register", json={
        "email": "  Mixed.Case@Example.COM  ",
        "password": password,
        "confirm_password": password,
        "nickname": "Unicode 用户",
    })
    duplicate = auth_client.post("/api/v1/auth/register", json={
        "email": "mixed.case@example.com",
        "password": "another-password",
        "confirm_password": "another-password",
    })

    assert first.status_code == 201
    assert first.json()["email"] == "mixed.case@example.com"
    assert password not in first.text
    assert duplicate.status_code == 409

    async def stored_credentials():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.scalar(select(User).where(User.email == "mixed.case@example.com"))
            return user.password_hash

    password_hash = asyncio.run(stored_credentials())
    assert password not in password_hash
    assert password_hash


@pytest.mark.parametrize(
    ("payload", "expected_status"),
    [
        ({"email": "not-an-email", "password": "123456", "confirm_password": "123456"}, 422),
        ({"email": "valid@example.com", "password": "12345", "confirm_password": "12345"}, 422),
        ({"email": "valid@example.com", "password": "123456", "confirm_password": "different"}, 422),
        ({"email": "", "password": "123456", "confirm_password": "123456"}, 422),
        ({"email": "valid@example.com", "password": "", "confirm_password": ""}, 422),
        ({"email": "a" * 247 + "@test.com", "password": "123456", "confirm_password": "123456"}, 422),
    ],
)
def test_registration_boundaries(auth_client, payload, expected_status):
    response = auth_client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == expected_status


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


def test_wechat_login_reports_missing_server_configuration(auth_client):
    response = auth_client.post("/api/v1/auth/wechat", json={"code": "temporary-code"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "wechat_login_not_configured"


def test_wechat_login_binds_verified_anonymous_user(auth_client, monkeypatch):
    registered = register_device(auth_client, "wechat-bind-device-001")
    auth_client.app.state.settings.WECHAT_APP_ID = "test-app-id"
    auth_client.app.state.settings.WECHAT_APP_SECRET = "test-app-secret"

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"openid": "wx-openid-001", "session_key": "must-not-leak"}

    async def fake_get(self, url, *, params):
        assert url == "https://api.weixin.qq.com/sns/jscode2session"
        assert params["js_code"] == "temporary-code"
        return FakeResponse()

    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
    response = auth_client.post(
        "/api/v1/auth/wechat",
        headers={"Authorization": f"Bearer {registered['access_token']}"},
        json={"code": "temporary-code"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == registered["user_id"]
    assert "session_key" not in response.text

    async def stored_openid():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.get(User, registered["user_id"])
            return user.wechat_openid

    assert asyncio.run(stored_openid()) == "wx-openid-001"


def test_wechat_login_rejects_invalid_exchange_response(auth_client, monkeypatch):
    auth_client.app.state.settings.WECHAT_APP_ID = "test-app-id"
    auth_client.app.state.settings.WECHAT_APP_SECRET = "test-app-secret"

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"errcode": 40029, "errmsg": "invalid code"}

    async def fake_get(self, url, *, params):
        return FakeResponse()

    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
    response = auth_client.post("/api/v1/auth/wechat", json={"code": "expired-code"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_wechat_code"


def test_wechat_phone_login_binds_verified_anonymous_user(auth_client, monkeypatch):
    registered = register_device(auth_client, "phone-bind-device-001")
    auth_client.app.state.settings.WECHAT_APP_ID = "test-app-id"
    auth_client.app.state.settings.WECHAT_APP_SECRET = "test-app-secret"

    async def bind_wechat_first():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.get(User, registered["user_id"])
            user.wechat_openid = "phone-flow-wechat-openid"
            await session.commit()

    asyncio.run(bind_wechat_first())

    class FakeTokenResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"access_token": "wechat-server-access-token", "expires_in": 7200}

    class FakePhoneResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "errcode": 0,
                "phone_info": {
                    "phoneNumber": "+86 13800138000",
                    "purePhoneNumber": "13800138000",
                    "countryCode": "86",
                },
            }

    async def fake_get(self, url, *, params):
        assert url == "https://api.weixin.qq.com/cgi-bin/token"
        assert params["appid"] == "test-app-id"
        return FakeTokenResponse()

    async def fake_post(self, url, *, params, json):
        assert url == "https://api.weixin.qq.com/wxa/business/getuserphonenumber"
        assert params["access_token"] == "wechat-server-access-token"
        assert json == {"code": "phone-code"}
        return FakePhoneResponse()

    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    response = auth_client.post(
        "/api/v1/auth/wechat-phone",
        headers={"Authorization": f"Bearer {registered['access_token']}"},
        json={"code": "phone-code"},
    )

    assert response.status_code == 200
    assert response.json()["user_id"] == registered["user_id"]
    assert response.json()["phone"] == "13800138000"
    assert "wechat-server-access-token" not in response.text

    async def stored_phone():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.get(User, registered["user_id"])
            return user.phone

    assert asyncio.run(stored_phone()) == "13800138000"


def test_wechat_phone_login_rejects_invalid_code(auth_client, monkeypatch):
    registered = register_device(auth_client, "phone-invalid-code-001")
    auth_client.app.state.settings.WECHAT_APP_ID = "test-app-id"
    auth_client.app.state.settings.WECHAT_APP_SECRET = "test-app-secret"

    async def bind_wechat_first():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.get(User, registered["user_id"])
            user.wechat_openid = "phone-invalid-wechat-openid"
            await session.commit()

    asyncio.run(bind_wechat_first())

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    async def fake_get(self, url, *, params):
        return FakeResponse({"access_token": "wechat-server-access-token"})

    async def fake_post(self, url, *, params, json):
        return FakeResponse({"errcode": 40029, "errmsg": "invalid code"})

    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
    monkeypatch.setattr("httpx.AsyncClient.post", fake_post)
    response = auth_client.post(
        "/api/v1/auth/wechat-phone",
        headers={"Authorization": f"Bearer {registered['access_token']}"},
        json={"code": "expired-code"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_wechat_phone_code"


def test_identity_status_and_bind_wechat_keep_current_account(auth_client, monkeypatch):
    registration = auth_client.post("/api/v1/auth/register", json={
        "email": "owner@example.com",
        "password": "correct-password",
        "confirm_password": "correct-password",
        "nickname": "原账号",
    }).json()
    auth_client.app.state.settings.WECHAT_APP_ID = "test-app-id"
    auth_client.app.state.settings.WECHAT_APP_SECRET = "test-app-secret"

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"openid": "bind-openid-001"}

    async def fake_get(self, url, *, params):
        return FakeResponse()

    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
    headers = {"Authorization": f"Bearer {registration['access_token']}"}
    before = auth_client.get("/api/v1/auth/identities", headers=headers)
    bound = auth_client.post("/api/v1/auth/bind-wechat", headers=headers, json={"code": "bind-code"})

    assert before.status_code == 200
    assert before.json()["email_masked"] == "ow***@example.com"
    assert before.json()["wechat_bound"] is False
    assert bound.status_code == 200
    assert bound.json()["wechat_bound"] is True

    async def stored_identity():
        async with auth_client.app.state.db_session_factory() as session:
            user = await session.get(User, registration["user_id"])
            return user.wechat_openid

    assert asyncio.run(stored_identity()) == "bind-openid-001"


def test_bind_wechat_rejects_identity_owned_by_another_account(auth_client, monkeypatch):
    first = register_device(auth_client, "bind-owner-001")
    second = register_device(auth_client, "bind-owner-002")
    auth_client.app.state.settings.WECHAT_APP_ID = "test-app-id"
    auth_client.app.state.settings.WECHAT_APP_SECRET = "test-app-secret"

    async def assign_owner():
        async with auth_client.app.state.db_session_factory() as session:
            owner = await session.get(User, first["user_id"])
            owner.wechat_openid = "already-owned-openid"
            await session.commit()

    asyncio.run(assign_owner())

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"openid": "already-owned-openid"}

    async def fake_get(self, url, *, params):
        return FakeResponse()

    monkeypatch.setattr("httpx.AsyncClient.get", fake_get)
    response = auth_client.post(
        "/api/v1/auth/bind-wechat",
        headers={"Authorization": f"Bearer {second['access_token']}"},
        json={"code": "bind-code"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "wechat_owned_by_another_account"
def test_legacy_wechat_environment_names_remain_supported(monkeypatch):
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)
    monkeypatch.delenv("WECHAT_APP_SECRET", raising=False)
    monkeypatch.setenv("WECHAT_MINI_APPID", "legacy-mini-app-id")
    monkeypatch.setenv("WECHAT_MINI_SECRET", "legacy-mini-secret")

    settings = Settings(_env_file=None)

    assert settings.WECHAT_APP_ID == "legacy-mini-app-id"
    assert settings.WECHAT_APP_SECRET == "legacy-mini-secret"
