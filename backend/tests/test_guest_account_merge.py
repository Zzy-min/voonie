import asyncio
from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import select

from voonie.backend.app.db.models import DiaryArtifact, DiaryEntry, Job, User
from voonie.backend.tests.test_auth import auth_client, register_device


def test_wechat_login_merges_completed_guest_diary_into_existing_owner(auth_client):
    guest_tokens = register_device(auth_client, "merge-guest-device")
    guest_id = guest_tokens["user_id"]

    async def seed():
        async with auth_client.app.state.db_session_factory() as db:
            owner = User(wechat_openid="existing-wechat-openid")
            db.add(owner)
            await db.flush()
            owner_id = owner.id
            db.add(DiaryEntry(
                user_id=owner_id, local_id="guest-entry", entry_date=datetime.now(timezone.utc),
                timezone="Asia/Shanghai", input_type="text", redacted_text="原微信日记",
                emotion_json={}, event_json={}, status="confirmed",
            ))
            db.add(Job(
                user_id=owner_id, type="comic", status="done", stage="done",
                idempotency_key="guest-comic", request_json={"text": "原微信日记"},
            ))
            entry = DiaryEntry(
                user_id=guest_id, local_id="guest-entry", entry_date=datetime.now(timezone.utc),
                timezone="Asia/Shanghai", input_type="text", redacted_text="游客的日记",
                emotion_json={}, event_json={}, status="confirmed",
            )
            job = Job(
                user_id=guest_id, type="comic", status="done", stage="done",
                idempotency_key="guest-comic", request_json={"text": "游客的日记"},
            )
            db.add_all((entry, job))
            await db.flush()
            db.add(DiaryArtifact(
                user_id=guest_id, job_id=job.id, entry_id=entry.id,
                artifact_type="illustrated_diary", version=1, title="游客绘本",
                emotion_label="开心", mood_score=7, companion_note="记住今天",
                panel_keys_json=[], character_snapshot_json={},
            ))
            await db.commit()
            return owner_id

    owner_id = asyncio.run(seed())

    async def exchange(*_):
        return "existing-wechat-openid"

    with patch("voonie.backend.app.api.routers.auth.require_wechat_configuration"), patch(
        "voonie.backend.app.api.routers.auth.exchange_wechat_openid", exchange,
    ):
        response = auth_client.post(
            "/api/v1/auth/wechat",
            json={"code": "test-code"},
            headers={"Authorization": f"Bearer {guest_tokens['access_token']}"},
        )
    assert response.status_code == 200
    assert response.json()["user_id"] == owner_id

    async def verify():
        async with auth_client.app.state.db_session_factory() as db:
            assert await db.get(User, guest_id) is None
            entry = await db.scalar(select(DiaryEntry).where(
                DiaryEntry.user_id == owner_id, DiaryEntry.redacted_text == "游客的日记",
            ))
            job = await db.scalar(select(Job).where(
                Job.user_id == owner_id, Job.request_json["text"].as_string() == "游客的日记",
            ))
            artifact = await db.scalar(select(DiaryArtifact).where(DiaryArtifact.user_id == owner_id))
            original = await db.scalar(select(DiaryEntry).where(
                DiaryEntry.user_id == owner_id, DiaryEntry.redacted_text == "原微信日记",
            ))
            assert original is not None
            assert entry.redacted_text == "游客的日记"
            assert job.status == "done"
            assert job.idempotency_key == f"merged-guest-{job.id}"
            assert artifact.title == "游客绘本"
            assert artifact.entry_id == entry.id

    asyncio.run(verify())
