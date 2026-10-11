import asyncio

import pytest
from sqlalchemy import select

from voonie.backend.app.core.exceptions import ApiError
from voonie.backend.app.db.models import Job, User
from voonie.backend.app.services.guest_generation_limit import require_guest_generation_slot
from voonie.backend.tests.test_entries import auth_headers, entries_client


def test_guest_remaining_and_server_side_limit(entries_client):
    client, _ = entries_client
    headers = auth_headers(client, "guest-generation-quota")
    profile = client.get("/api/v1/auth/me", headers=headers).json()
    assert profile["wechat_bound"] is False
    assert profile["guest_generations_remaining"] == 2

    async def mark_two_completed():
        async with client.app.state.db_session_factory() as db:
            user = await db.get(User, profile["id"])
            user.guest_generated_count = 2
            await db.commit()

    asyncio.run(mark_two_completed())
    assert client.get("/api/v1/auth/me", headers=headers).json()["guest_generations_remaining"] == 0

    entry = client.post("/api/v1/entries/text", headers=headers | {"Idempotency-Key": "guest-entry"}, json={
        "local_id": "guest-entry", "text": "今天的游客日记", "entry_date": "2026-09-26T00:00:00Z",
        "timezone": "Asia/Shanghai",
    })
    assert entry.status_code == 201
    blocked = client.post(f"/api/v1/entries/{entry.json()['id']}/comic-jobs", headers=headers | {
        "Idempotency-Key": "guest-third-comic",
    }, json={})
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "wechat_login_required_after_trial"


def test_active_job_reserves_guest_slot_and_failed_job_does_not(entries_client):
    client, _ = entries_client
    headers = auth_headers(client, "guest-active-quota")
    user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

    async def inspect():
        async with client.app.state.db_session_factory() as db:
            user = await db.get(User, user_id)
            user.guest_generated_count = 1
            db.add(Job(user_id=user_id, type="storybook", status="queued", request_json={}, idempotency_key="active-1"))
            await db.commit()
            assert client.get("/api/v1/auth/me", headers=headers).json()["guest_generations_remaining"] == 0
            with pytest.raises(ApiError) as exc:
                await require_guest_generation_slot(db, user)
            assert exc.value.code == "wechat_login_required_after_trial"
            active = await db.scalar(select(Job).where(Job.user_id == user_id))
            active.status = "failed"
            await db.commit()
            await require_guest_generation_slot(db, user)

    asyncio.run(inspect())
