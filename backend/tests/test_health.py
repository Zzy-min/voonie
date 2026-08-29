from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.main import create_app


def make_settings(**overrides):
    values = {
        "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
        "REDIS_URL": "redis://127.0.0.1:1/0",
        "ARQ_INLINE": True,
        "CORS_ORIGINS": ["http://localhost:3000"],
        "TESTING": True,
    }
    values.update(overrides)
    return Settings(**values)


def test_health_reports_application_and_database_status():
    with TestClient(create_app(make_settings())) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app": "Voonie Comic Voice Diary API",
        "version": "1.0.0",
        "checks": {"database": "ok"},
    }


def test_ready_skips_redis_in_inline_mode():
    with TestClient(create_app(make_settings())) as client:
        response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "redis": "skipped"}


def test_ready_returns_503_when_redis_is_unavailable():
    settings = make_settings(ARQ_INLINE=False)
    with TestClient(create_app(settings)) as client:
        response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_not_ready"
    assert response.json()["error"]["details"]["redis"] == "unavailable"


def test_cors_uses_configured_origin_with_credentials():
    with TestClient(create_app(make_settings())) as client:
        response = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_wildcard_cors_disables_credentials():
    app = create_app(make_settings(CORS_ORIGINS=["*"]))
    cors = next(middleware for middleware in app.user_middleware if middleware.cls.__name__ == "CORSMiddleware")

    assert cors.kwargs["allow_origins"] == ["*"]
    assert cors.kwargs["allow_credentials"] is False


def test_cors_origins_accept_comma_separated_environment_value(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.example, http://b.example")

    configured = Settings()

    assert configured.CORS_ORIGINS == ["http://a.example", "http://b.example"]
