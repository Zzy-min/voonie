import asyncio
from pathlib import Path
import uuid

import pytest
from fastapi.testclient import TestClient

from voonie.backend.app.core.config import Settings
from sqlalchemy import func, select

from voonie.backend.app.db.models import Base, DiaryArtifact, Job, Panel, ShareReport
from voonie.backend.app.main import create_app


@pytest.fixture
def share_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    test_id = uuid.uuid4().hex
    database_path = data_dir / f"shares-{test_id}.db"
    media_dir = data_dir / f"shares-media-{test_id}"
    app = create_app(Settings(DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="share-test-secret-that-is-long-enough", TEMP_MEDIA_DIR=media_dir,
        ARQ_INLINE=True, TESTING=False))

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    asyncio.run(create_schema())
    with TestClient(app) as client:
        yield client, app
    asyncio.run(app.state.db_engine.dispose())
    database_path.unlink(missing_ok=True)


def auth(client: TestClient, device: str) -> tuple[dict[str, str], str]:
    response = client.post("/api/v1/auth/device", json={"device_id": device, "app_version": "1.0.0"})
    body = response.json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    return headers, user_id


def seed_diary(app, user_id: str) -> str:
    job_id = str(uuid.uuid4())
    artifact_id = str(uuid.uuid4())

    async def seed():
        async with app.state.db_session_factory() as db:
            job = Job(id=job_id, user_id=user_id, type="comic", status="done", stage="done",
                progress=1, request_json={}, result_json={})
            artifact = DiaryArtifact(id=artifact_id, user_id=user_id, job_id=job_id, title="晚霞散步",
                emotion_label="开心", mood_score=80, transcript_redacted="今天的日记正文",
                companion_note="温暖的一天")
            panel = Panel(artifact_id=artifact_id, panel_no=1, storyboard_json={}, image_key="panel.png")
            db.add_all([job, artifact, panel])
            await db.commit()
    asyncio.run(seed())
    return job_id


def test_private_share_is_hidden_and_public_share_supports_reactions(share_client):
    client, app = share_client
    owner_headers, owner_id = auth(client, "share-owner-device")
    viewer_headers, _ = auth(client, "share-viewer-device")
    diary_id = seed_diary(app, owner_id)
    payload = {"artifact_id": diary_id, "caption": "今天和小狗看晚霞", "tags": ["晚霞"], "is_public": False}

    created = client.post("/api/v1/shares", headers=owner_headers, json=payload)
    assert created.status_code == 201
    assert client.get("/api/v1/shares", headers=viewer_headers).json() == []

    published = client.post("/api/v1/shares", headers=owner_headers, json=payload | {"is_public": True})
    assert published.status_code == 201
    post = client.get("/api/v1/shares?order=latest", headers=viewer_headers).json()[0]
    assert post["artifact_id"] == diary_id
    assert post["caption"] == "今天的日记正文"
    assert post["author"] == "小主人"
    assert post["image_url"].startswith("/api/v1/shares/")

    detail = client.get(f"/api/v1/shares/{post['id']}", headers=viewer_headers)
    assert detail.status_code == 200
    assert detail.json()["content"] == "今天的日记正文"
    assert detail.json()["title"] == "晚霞散步"
    assert detail.json()["is_owner"] is False
    forbidden_edit = client.patch(
        f"/api/v1/diaries/{diary_id}",
        headers=viewer_headers,
        json={"title": "越权修改", "content": "不应成功", "expected_version": 0},
    )
    assert forbidden_edit.status_code == 404

    liked = client.put(f"/api/v1/shares/{post['id']}/reactions/like", headers=viewer_headers)
    assert liked.json() == {"active": True, "count": 1}
    unliked = client.put(f"/api/v1/shares/{post['id']}/reactions/like", headers=viewer_headers)
    assert unliked.json() == {"active": False, "count": 0}


def test_user_cannot_publish_another_users_diary(share_client):
    client, app = share_client
    owner_headers, owner_id = auth(client, "share-owner-two")
    other_headers, _ = auth(client, "share-other-two")
    diary_id = seed_diary(app, owner_id)
    response = client.post("/api/v1/shares", headers=other_headers,
        json={"artifact_id": diary_id, "caption": "越权发布", "is_public": True})
    assert response.status_code == 404


def test_share_owner_can_make_private_republish_and_delete_while_reports_are_idempotent(share_client):
    client, app = share_client
    owner_headers, owner_id = auth(client, "share-governance-owner")
    viewer_headers, _ = auth(client, "share-governance-viewer")
    diary_id = seed_diary(app, owner_id)
    payload = {"artifact_id": diary_id, "caption": "可治理的公开内容", "is_public": True}

    created = client.post("/api/v1/shares", headers=owner_headers, json=payload)
    assert created.status_code == 201
    post = created.json()
    assert post["is_owner"] is True
    post_id = post["id"]

    viewer_post = client.get("/api/v1/shares", headers=viewer_headers).json()[0]
    assert viewer_post["is_owner"] is False
    first_report = client.post(f"/api/v1/shares/{post_id}/reports", headers=viewer_headers,
                               json={"reason": "spam", "detail": "重复广告"})
    second_report = client.post(f"/api/v1/shares/{post_id}/reports", headers=viewer_headers,
                                json={"reason": "spam", "detail": "重复广告"})
    assert first_report.status_code == second_report.status_code == 201
    assert first_report.json() == {"submitted": True}
    async def report_count():
        async with app.state.db_session_factory() as db:
            return await db.scalar(select(func.count()).select_from(ShareReport))
    assert asyncio.run(report_count()) == 1

    made_private = client.patch(f"/api/v1/shares/{post_id}", headers=owner_headers, json={"is_public": False})
    assert made_private.status_code == 200
    assert client.get("/api/v1/shares", headers=viewer_headers).json() == []
    media_name = post["image_url"].rsplit("/", 1)[-1]
    assert client.get(f"/api/v1/shares/{post_id}/media/{media_name}").status_code == 404

    republished = client.post("/api/v1/shares", headers=owner_headers, json=payload)
    assert republished.status_code == 201
    assert republished.json()["id"] == post_id
    assert client.delete(f"/api/v1/shares/{post_id}", headers=viewer_headers).status_code == 404
    assert client.delete(f"/api/v1/shares/{post_id}", headers=owner_headers).status_code == 204
    async def diary_still_exists():
        async with app.state.db_session_factory() as db:
            return await db.scalar(select(func.count()).select_from(DiaryArtifact).where(DiaryArtifact.job_id == diary_id))
    assert asyncio.run(diary_still_exists()) == 1
    assert client.get("/api/v1/shares", headers=viewer_headers).json() == []
