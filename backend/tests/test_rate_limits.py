import time

from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.main import create_app


def test_default_audio_limits_match_product_contract():
    settings = Settings()
    assert settings.MAX_AUDIO_BYTES == 16 * 1024 * 1024
    assert settings.MAX_AUDIO_SECONDS == 600


def test_comic_and_chat_hourly_limits_return_429():
    app = create_app(Settings(
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        JWT_SECRET="rate-limit-test-secret-long-enough",
        TESTING=True,
        COMIC_HOURLY_LIMIT=1,
        CHAT_HOURLY_LIMIT=1,
    ))
    with TestClient(app) as client:
        first_comic = client.post("/api/v1/jobs/comic", json={"text": "今天完成了一次限流测试。"})
        second_comic = client.post("/api/v1/jobs/comic", json={"text": "第二次请求应被限制。"})
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status = client.get(f"/api/v1/jobs/{first_comic.json()['job_id']}").json()["status"]
            if status in {"done", "failed", "cancelled"}:
                break
            time.sleep(0.02)
        first_chat = client.post("/api/v1/pet/chat", json={"message": "今天有点累"})
        second_chat = client.post("/api/v1/pet/chat", json={"message": "再聊一句"})

    assert first_comic.status_code == 202
    assert second_comic.status_code == 429
    assert second_comic.json()["error"]["code"] == "rate_limit_exceeded"
    assert first_chat.status_code == 200
    assert second_chat.status_code == 429
    assert second_chat.json()["error"]["code"] == "rate_limit_exceeded"
