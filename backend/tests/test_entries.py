import asyncio
import io
from pathlib import Path
import time
import uuid
import wave

import pytest
from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base
from voonie.backend.app.main import create_app


@pytest.fixture
def entries_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    test_id = uuid.uuid4().hex
    database_path = data_dir / f"entries-{test_id}.db"
    media_dir = data_dir / f"media-{test_id}"
    app = create_app(Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="entries-test-secret-that-is-long-enough",
        TEMP_MEDIA_DIR=media_dir,
        MAX_AUDIO_BYTES=128,
        ALLOW_MOCK_ASR=True,
        ARQ_INLINE=True,
    ))

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    with TestClient(app) as client:
        yield client, media_dir
    asyncio.run(app.state.db_engine.dispose())
    for _ in range(20):
        try:
            database_path.unlink(missing_ok=True)
            break
        except PermissionError:
            time.sleep(0.05)
    if media_dir.exists():
        for item in media_dir.iterdir():
            item.unlink()
        media_dir.rmdir()


def auth_headers(client: TestClient, device: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/device", json={"device_id": device, "app_version": "1.0.0"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def wav_bytes(frame_count: int = 8) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(1)
        wav.setframerate(8000)
        wav.writeframes(b"\x80" * frame_count)
    return output.getvalue()


def test_text_entry_crud_idempotency_and_user_isolation(entries_client):
    client, _ = entries_client
    owner = auth_headers(client, "entry-owner")
    other = auth_headers(client, "entry-other")
    headers = owner | {"Idempotency-Key": "local-entry-1"}
    payload = {
        "local_id": "local-entry-1",
        "text": "今天在回家的路上看到了很漂亮的晚霞。",
        "entry_date": "2026-08-27T12:30:00Z",
        "timezone": "Asia/Shanghai",
    }

    first = client.post("/api/v1/entries/text", headers=headers, json=payload)
    second = client.post("/api/v1/entries/text", headers=headers, json=payload)
    assert first.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["emotion"]["label"]
    assert "safety" in first.json()["events"]
    assert "category" not in first.json()["emotion"]
    conflict = client.post(
        "/api/v1/entries/text",
        headers=headers,
        json=payload | {"text": "不同的正文不应复用同一个 local_id。"},
    )
    assert conflict.status_code == 409
    entry_id = first.json()["id"]
    assert client.get(f"/api/v1/entries/{entry_id}", headers=other).status_code == 404

    updated = client.patch(
        f"/api/v1/entries/{entry_id}",
        headers=owner,
        json={"text": "确认后的日记文本。", "status": "confirmed"},
    )
    assert updated.json()["redacted_text"] == "确认后的日记文本。"
    assert client.patch(f"/api/v1/entries/{entry_id}", headers=owner, json={"text": None}).status_code == 422
    assert client.delete(f"/api/v1/entries/{entry_id}", headers=owner).status_code == 204
    assert client.get(f"/api/v1/entries/{entry_id}", headers=owner).status_code == 404


def test_date_filter_uses_requested_timezone(entries_client):
    client, _ = entries_client
    auth = auth_headers(client, "entry-timezone")
    headers = auth | {"Idempotency-Key": "midnight-entry"}
    client.post("/api/v1/entries/text", headers=headers, json={
        "local_id": "midnight-entry",
        "text": "凌晨一点记录的日记。",
        "entry_date": "2026-08-26T17:00:00Z",
        "timezone": "Asia/Shanghai",
    })

    local_day = client.get("/api/v1/entries?date=2026-08-27&timezone=Asia/Shanghai", headers=auth)
    previous_utc_day = client.get("/api/v1/entries?date=2026-08-26&timezone=Asia/Shanghai", headers=auth)
    assert len(local_day.json()["items"]) == 1
    assert previous_utc_day.json()["items"] == []


def test_voice_entry_is_draft_and_temp_audio_is_removed(entries_client):
    client, media_dir = entries_client
    auth = auth_headers(client, "entry-voice") | {"Idempotency-Key": "voice-local-1"}
    response = client.post(
        "/api/v1/entries/voice",
        headers=auth,
        files={"audio_file": ("voice.wav", wav_bytes(), "audio/wav")},
        data={"local_id": "voice-local-1", "entry_date": "2026-08-27T10:00:00Z", "timezone": "Asia/Shanghai"},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "draft"
    assert response.json()["input_type"] == "voice"
    assert list(media_dir.glob("voice_*")) == []


def test_voice_rejects_unsupported_and_oversized_files(entries_client):
    client, media_dir = entries_client
    auth = auth_headers(client, "entry-invalid-voice") | {"Idempotency-Key": "invalid-voice"}
    data = {"local_id": "invalid-voice", "entry_date": "2026-08-27T10:00:00Z", "timezone": "UTC"}
    unsupported = client.post(
        "/api/v1/entries/voice", headers=auth,
        files={"audio_file": ("payload.txt", b"not audio", "text/plain")}, data=data,
    )
    assert unsupported.status_code == 415
    forged = client.post(
        "/api/v1/entries/voice", headers=auth,
        files={"audio_file": ("voice.wav", b"this is not a wav", "audio/wav")}, data=data,
    )
    assert forged.status_code == 415
    oversized = client.post(
        "/api/v1/entries/voice", headers=auth,
        files={"audio_file": ("voice.wav", b"x" * 129, "audio/wav")}, data=data,
    )
    assert oversized.status_code == 413
    assert list(media_dir.glob("voice_*")) == []


def test_entry_date_requires_utc_offset(entries_client):
    client, _ = entries_client
    headers = auth_headers(client, "entry-naive-date") | {"Idempotency-Key": "naive-date"}
    response = client.post("/api/v1/entries/text", headers=headers, json={
        "local_id": "naive-date",
        "text": "没有时区偏移的时间应被拒绝。",
        "entry_date": "2026-08-27T10:00:00",
        "timezone": "Asia/Shanghai",
    })
    assert response.status_code == 422


def test_invalid_analysis_keeps_the_entry_and_marks_failed(entries_client):
    client, _ = entries_client

    class InvalidAnalyzer:
        async def analyze(self, text: str):
            raise ValueError("invalid json")

    client.app.state.diary_analyzer = InvalidAnalyzer()
    headers = auth_headers(client, "entry-analysis-failed") | {"Idempotency-Key": "analysis-failed"}
    response = client.post("/api/v1/entries/text", headers=headers, json={
        "local_id": "analysis-failed",
        "text": "FORCE_INVALID_ANALYSIS 今天只是随便说了两句。",
        "entry_date": "2026-08-27T10:00:00Z",
        "timezone": "UTC",
    })
    assert response.status_code == 201
    assert response.json()["status"] == "analysis_failed"
    assert response.json()["redacted_text"].startswith("FORCE_INVALID_ANALYSIS")
    assert response.json()["events"]["analysis_error"] == "invalid_json"
