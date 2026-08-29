import asyncio
from pathlib import Path
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base
from voonie.backend.app.db.models import DiaryArtifact, DiaryEntry, Panel
from sqlalchemy import func, select
from voonie.backend.app.main import create_app
from voonie.backend.app.services.image_gen_service import ImageGenService


@pytest.fixture
def jobs_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    database_path = data_dir / f"jobs-{uuid.uuid4().hex}.db"
    app = create_app(
        Settings(
            DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
            JWT_SECRET="jobs-test-secret-that-is-long-enough",
            ARQ_INLINE=True,
            TESTING=False,
        )
    )

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    with TestClient(app) as client:
        yield client
    database_path.unlink()


def auth_headers(client: TestClient, device_id: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/device",
        json={"device_id": device_id, "app_version": "1.0.0"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def wait_for_job(client: TestClient, job_id: str, headers: dict[str, str]) -> dict:
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/jobs/{job_id}", headers=headers)
        assert response.status_code == 200
        body = response.json()
        if body["status"] in {"done", "failed"}:
            return body
        time.sleep(0.05)
    raise AssertionError("job did not reach a terminal state")


def test_diary_job_keeps_full_text_and_creates_sparse_anchored_illustrations(jobs_client):
    headers = auth_headers(jobs_client, "jobs-device-001")

    response = jobs_client.post(
        "/api/v1/jobs/comic",
        headers=headers,
        json={"text": "今天喝了奶茶，下班时看到晚霞，心情很好。"},
    )

    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    completed = wait_for_job(jobs_client, response.json()["job_id"], headers)
    assert completed["status"] == "done"
    assert completed["stage"] == "done"
    assert completed["progress"] == 1.0
    assert len(completed["result"]["panels"]) == 1
    assert completed["result"]["composite_comic_url"] is None
    assert completed["result"]["organized_diary"] == "今天喝了奶茶，下班时看到晚霞，心情很好。"
    assert completed["result"]["emotion_curve"]
    assert completed["result"]["panels"][0]["anchor_text"] in completed["result"]["organized_diary"]


def test_job_status_is_isolated_by_user(jobs_client):
    owner = auth_headers(jobs_client, "jobs-owner-001")
    other = auth_headers(jobs_client, "jobs-other-001")
    created = jobs_client.post(
        "/api/v1/jobs/comic",
        headers=owner,
        json={"text": "今天完成了一个重要任务，终于可以休息了。"},
    )
    job_id = created.json()["job_id"]

    response = jobs_client.get(f"/api/v1/jobs/{job_id}", headers=other)

    assert response.status_code == 404


def test_idempotency_key_returns_existing_job(jobs_client):
    headers = auth_headers(jobs_client, "jobs-idempotency-001")
    headers["Idempotency-Key"] = "comic-request-001"
    payload = {"text": "今天散步时遇见一只很亲人的小猫。"}

    first = jobs_client.post("/api/v1/jobs/comic", headers=headers, json=payload)
    second = jobs_client.post("/api/v1/jobs/comic", headers=headers, json=payload)

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]


def test_job_events_stream_terminal_event(jobs_client):
    headers = auth_headers(jobs_client, "jobs-events-001")
    created = jobs_client.post(
        "/api/v1/jobs/comic",
        headers=headers,
        json={"text": "早晨吃到很好吃的面包，一整天都很满足。"},
    )
    job_id = created.json()["job_id"]
    completed = wait_for_job(jobs_client, job_id, headers)
    assert completed["status"] == "done"

    response = jobs_client.get(f"/api/v1/jobs/{job_id}/events", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: done" in response.text


class FailingImageProvider:
    async def generate(self, prompt: str, *, ref_image: bytes | None, seed: int | None) -> bytes:
        raise RuntimeError("image provider unavailable")


def test_provider_failure_is_persisted_as_failed_job(jobs_client):
    jobs_client.app.state.image_service = ImageGenService(provider=FailingImageProvider())
    headers = auth_headers(jobs_client, "jobs-failure-001")

    created = jobs_client.post(
        "/api/v1/jobs/comic",
        headers=headers,
        json={"text": "今天想记录一件普通但重要的小事。"},
    )
    failed = wait_for_job(jobs_client, created.json()["job_id"], headers)

    assert failed["status"] == "failed"
    assert failed["stage"] == "failed"
    assert "RuntimeError: image provider unavailable" in failed["error"]


def test_legacy_endpoint_persists_entry_artifact_and_panels(jobs_client):
    headers = auth_headers(jobs_client, "legacy-persistence-001")
    headers["Idempotency-Key"] = "legacy-comic-001"
    payload = {"text": "今天完成了持久化改造，准备记录这件值得纪念的小事。"}

    first = jobs_client.post("/api/v1/diaries/text-generate", headers=headers, json=payload)
    second = jobs_client.post("/api/v1/diaries/text-generate", headers=headers, json=payload)

    assert first.status_code == 200
    assert first.headers["Deprecation"] == "true"
    assert first.json()["job_id"] == second.json()["job_id"]
    history = jobs_client.get("/api/v1/diaries", headers=headers)
    assert history.status_code == 200
    assert [item["job_id"] for item in history.json()] == [first.json()["job_id"]]

    async def counts():
        async with jobs_client.app.state.db_session_factory() as session:
            return (
                await session.scalar(select(func.count()).select_from(DiaryEntry)),
                await session.scalar(select(func.count()).select_from(DiaryArtifact)),
                await session.scalar(select(func.count()).select_from(Panel)),
            )

    assert asyncio.run(counts()) == (1, 1, 1)


def test_diary_text_edit_persists_without_overwriting_source_or_illustration(jobs_client):
    headers = auth_headers(jobs_client, "diary-edit-persistence-001")
    original_text = "今天考试没考好，一开始很失落。晚上看到橙色晚霞，心情好了很多。"
    edited_text = "今天考试没考好，一开始有些失落。晚上看到橙色晚霞，心情好了很多。"
    created = jobs_client.post(
        "/api/v1/diaries/text-generate",
        headers=headers,
        json={"text": original_text},
    )
    assert created.status_code == 200
    diary = created.json()
    original_image_url = diary["panels"][0]["image_url"]

    updated = jobs_client.patch(
        f"/api/v1/entries/{diary['entry_id']}",
        headers=headers,
        json={"text": edited_text},
    )
    assert updated.status_code == 200

    reloaded = jobs_client.get(f"/api/v1/diaries/{diary['job_id']}", headers=headers)
    assert reloaded.status_code == 200
    assert reloaded.json()["organized_diary"] == edited_text
    assert reloaded.json()["raw_transcript"] == original_text
    assert reloaded.json()["panels"][0]["image_url"] == original_image_url

    async def artifact_text():
        async with jobs_client.app.state.db_session_factory() as session:
            artifact = await session.scalar(
                select(DiaryArtifact).where(DiaryArtifact.job_id == diary["job_id"])
            )
            return artifact.transcript_redacted

    assert asyncio.run(artifact_text()) == edited_text


def test_history_normalizes_legacy_naive_utc_timestamp(jobs_client):
    headers = auth_headers(jobs_client, "diary-timezone-normalization-001")
    created = jobs_client.post(
        "/api/v1/diaries/text-generate",
        headers=headers,
        json={"text": "今天想确认重绘以后日记日期不会回退一天。"},
    )
    job_id = created.json()["job_id"]

    async def make_timestamp_naive():
        async with jobs_client.app.state.db_session_factory() as session:
            from voonie.backend.app.db.models import Job
            job = await session.get(Job, job_id)
            result = dict(job.result_json)
            result["created_at"] = "2026-08-28T17:30:00"
            job.result_json = result
            await session.commit()

    asyncio.run(make_timestamp_naive())
    history = jobs_client.get(f"/api/v1/diaries/{job_id}", headers=headers)

    assert history.status_code == 200
    assert history.json()["created_at"] == "2026-08-28T17:30:00+00:00"


def test_legacy_diary_can_be_deleted(jobs_client):
    headers = auth_headers(jobs_client, "legacy-delete-001")
    created = jobs_client.post("/api/v1/diaries/text-generate", headers=headers, json={"text": "今天想删掉这篇记录做验收。"})
    job_id = created.json()["job_id"]
    media_url = created.json()["panels"][0]["image_url"]
    media_path = "/media/" + media_url.rsplit("/", 1)[-1]
    assert jobs_client.get(media_path).status_code == 200
    deleted = jobs_client.delete(f"/api/v1/diaries/{job_id}", headers=headers)
    assert deleted.status_code == 204
    history = jobs_client.get("/api/v1/diaries", headers=headers)
    assert history.json() == []
    assert jobs_client.get(media_path).status_code == 404


def test_queued_job_can_be_cancelled(jobs_client):
    headers = auth_headers(jobs_client, "jobs-cancel-001")
    created = jobs_client.post("/api/v1/jobs/comic", headers=headers, json={"text": "今天想取消这次生成任务。"})
    job_id = created.json()["job_id"]
    cancelled = jobs_client.post(f"/api/v1/jobs/{job_id}/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] in {"cancelled", "done", "failed"}
    if cancelled.json()["status"] == "cancelled":
        terminal = jobs_client.get(f"/api/v1/jobs/{job_id}", headers=headers).json()
        assert terminal["status"] == "cancelled"
        events = jobs_client.get(f"/api/v1/jobs/{job_id}/events", headers=headers)
        assert "event: cancelled" in events.text
