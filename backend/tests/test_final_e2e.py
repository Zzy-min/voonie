import asyncio
import io
import time
import uuid
import wave
from pathlib import Path

from fastapi.testclient import TestClient
from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base
from voonie.backend.app.main import create_app


def wav_bytes(seconds: float = 0.1) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(1)
        wav.setframerate(8000)
        wav.writeframes(b"\x80" * int(8000 * seconds))
    return output.getvalue()


def wait_for_job(client: TestClient, job_id: str, headers: dict[str, str]) -> dict:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/jobs/{job_id}", headers=headers)
        if response.json()["status"] in {"done", "failed", "cancelled"}:
            return response.json()
        time.sleep(0.03)
    raise AssertionError("job did not finish")


def test_full_voice_diary_chat_illustration_history_and_cross_user_isolation():
    test_dir = Path("voonie/backend/.pytest-data") / f"final-e2e-{uuid.uuid4().hex}"
    test_dir.mkdir(parents=True)
    database = test_dir / "final-e2e.db"
    app = create_app(Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database.as_posix()}",
        JWT_SECRET="final-e2e-secret-that-is-long-enough",
        TEMP_MEDIA_DIR=test_dir / "media",
        ARQ_INLINE=True,
        ALLOW_MOCK_ASR=True,
        TESTING=False,
    ))

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    with TestClient(app) as client:
        user_a = client.post("/api/v1/auth/register", json={
            "email": "e2e-a@example.com",
            "password": "correct-password",
            "confirm_password": "correct-password",
            "nickname": "用户A",
        })
        assert user_a.status_code == 201
        a_headers = {"Authorization": f"Bearer {user_a.json()['access_token']}"}
        login = client.post("/api/v1/auth/login", json={
            "email": " E2E-A@EXAMPLE.COM ",
            "password": "correct-password",
        })
        assert login.status_code == 200

        local_id = "final-e2e-voice"
        voice = client.post(
            "/api/v1/entries/voice",
            headers=a_headers | {"Idempotency-Key": local_id},
            files={"audio_file": ("today.wav", wav_bytes(), "audio/wav")},
            data={
                "local_id": local_id,
                "entry_date": "2026-08-30T20:00:00+08:00",
                "timezone": "Asia/Shanghai",
            },
        )
        assert voice.status_code == 201
        entry_id = voice.json()["id"]
        assert voice.json()["redacted_text"]

        chat = client.post("/api/v1/pet/chat", headers=a_headers, json={"message": "今天的记录里有什么？"})
        assert chat.status_code == 200
        comic = client.post(
            f"/api/v1/entries/{entry_id}/comic-jobs",
            headers=a_headers | {"Idempotency-Key": "final-e2e-comic"},
            json={},
        )
        assert comic.status_code == 202
        completed = wait_for_job(client, comic.json()["job_id"], a_headers)
        assert completed["status"] == "done"
        assert completed["result"]["organized_diary"]
        assert completed["result"]["panels"]
        assert client.get("/api/v1/diaries", headers=a_headers).json()

        user_b = client.post("/api/v1/auth/register", json={
            "email": "e2e-b@example.com",
            "password": "correct-password",
            "confirm_password": "correct-password",
            "nickname": "用户B",
        })
        b_headers = {"Authorization": f"Bearer {user_b.json()['access_token']}"}
        assert client.get(f"/api/v1/entries/{entry_id}", headers=b_headers).status_code == 404
        assert client.get(f"/api/v1/jobs/{completed['job_id']}", headers=b_headers).status_code == 404
        assert client.get("/api/v1/diaries", headers=b_headers).json() == []

    asyncio.run(app.state.db_engine.dispose())
    for item in sorted(test_dir.rglob("*"), reverse=True):
        if item.is_file():
            item.unlink(missing_ok=True)
        elif item.is_dir():
            item.rmdir()
    test_dir.rmdir()
