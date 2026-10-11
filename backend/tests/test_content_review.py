import asyncio
import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import User
from voonie.backend.app.services.content_review import ContentReview
from voonie.backend.app.services.wechat_content_safety import (
    ContentReviewRejected, ContentReviewUnavailable, WechatContentSafety,
)
from voonie.backend.tests.test_entries import auth_headers, entries_client


def test_wechat_text_review_checks_every_chunk_and_rejects_risk():
    calls = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "test-token", "expires_in": 7200})
        calls.append(request)
        return httpx.Response(200, json={"errcode": 0, "result": {"suggest": "risky", "label": 20002}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            review = WechatContentSafety(Settings(WECHAT_APP_ID="test-app", WECHAT_APP_SECRET="test-secret"), client)
            with pytest.raises(ContentReviewRejected):
                await review.check_text("a" * 2501, "test-openid")

    asyncio.run(run())
    assert len(calls) == 1


def test_wechat_text_review_checks_second_chunk_and_rejects_review():
    calls = []

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "test-token", "expires_in": 7200})
        calls.append(json.loads(request.content))
        suggestion = "pass" if len(calls) == 1 else "review"
        return httpx.Response(200, json={"errcode": 0, "result": {"suggest": suggestion}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            review = WechatContentSafety(Settings(WECHAT_APP_ID="test-app", WECHAT_APP_SECRET="test-secret"), client)
            with pytest.raises(ContentReviewRejected):
                await review.check_text("a" * 2501, "test-openid")

    asyncio.run(run())
    assert [len(call["content"]) for call in calls] == [2500, 1]


def test_wechat_text_review_retries_expired_access_token_once():
    token_calls = 0
    check_tokens = []

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal token_calls
        if request.url.path == "/cgi-bin/token":
            token_calls += 1
            return httpx.Response(200, json={"access_token": f"token-{token_calls}", "expires_in": 7200})
        check_tokens.append(request.url.params["access_token"])
        if check_tokens[-1] == "token-1":
            return httpx.Response(200, json={"errcode": 40001, "errmsg": "invalid credential"})
        return httpx.Response(200, json={"errcode": 0, "result": {"suggest": "pass", "label": 100}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            review = WechatContentSafety(Settings(WECHAT_APP_ID="test-app", WECHAT_APP_SECRET="test-secret"), client)
            await review.check_text("今天的日记", "test-openid")

    asyncio.run(run())
    assert token_calls == 2
    assert check_tokens == ["token-1", "token-2"]


def test_independent_review_checks_every_chunk_and_fails_closed():
    calls = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"results": [{"flagged": False}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            settings = Settings(CONTENT_REVIEW_ENABLED=True, OPENAI_API_KEY="test-key")
            await ContentReview(settings, client).check_text("a" * 5001)

    asyncio.run(run())
    assert len(calls) == 3


def test_bound_user_uses_wechat_text_without_independent_key():
    calls = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/cgi-bin/token":
            return httpx.Response(200, json={"access_token": "test-token", "expires_in": 7200})
        return httpx.Response(200, json={"errcode": 0, "result": {"suggest": "pass", "label": 100}})

    async def run():
        settings = Settings(
            CONTENT_REVIEW_ENABLED=True, WECHAT_CONTENT_REVIEW_ENABLED=True,
            OPENAI_API_KEY="", WECHAT_APP_ID="test-app", WECHAT_APP_SECRET="test-secret",
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await ContentReview(settings, client).check_text("今天的日记", "test-openid")

    asyncio.run(run())
    assert calls == ["/cgi-bin/token", "/wxa/msg_sec_check"]


def test_independent_review_rejects_flagged_and_missing_results():
    async def check(payload):
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=payload)
        )) as client:
            settings = Settings(CONTENT_REVIEW_ENABLED=True, OPENAI_API_KEY="test-key")
            await ContentReview(settings, client).check_text("hello")

    with pytest.raises(ContentReviewRejected):
        asyncio.run(check({"results": [{"flagged": True}]}))
    with pytest.raises(ContentReviewUnavailable):
        asyncio.run(check({"results": []}))
    with pytest.raises(ContentReviewUnavailable):
        asyncio.run(check({"results": [None]}))
    with pytest.raises(ContentReviewUnavailable):
        asyncio.run(check([{"flagged": False}]))


def test_independent_image_review_submits_data_url():
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"results": [{"flagged": False}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            settings = Settings(CONTENT_REVIEW_ENABLED=True, IMAGE_CONTENT_REVIEW_ENABLED=True, OPENAI_API_KEY="test-key")
            await ContentReview(settings, client).check_image(b"image-data", "image/png")

    asyncio.run(run())
    assert requests[0]["input"][0]["image_url"]["url"].startswith("data:image/png;base64,")


def test_text_entry_is_not_saved_when_review_rejects(entries_client):
    client, _ = entries_client
    owner = auth_headers(client, "review-blocked-owner")
    owner_id = client.get("/api/v1/auth/me", headers=owner).json()["id"]

    async def bind_for_review():
        async with client.app.state.db_session_factory() as db:
            user = await db.get(User, owner_id)
            user.wechat_openid = "review-test-openid"
            await db.commit()

    asyncio.run(bind_for_review())

    class RejectAll:
        async def check_text(self, *_):
            raise ContentReviewRejected("risky")

    original = client.app.state.content_review
    original_enabled = client.app.state.settings.CONTENT_REVIEW_ENABLED
    client.app.state.settings.CONTENT_REVIEW_ENABLED = True
    client.app.state.content_review = RejectAll()
    try:
        response = client.post("/api/v1/entries/text", headers=owner | {"Idempotency-Key": "blocked-1"}, json={
            "local_id": "blocked-1", "text": "blocked text",
            "entry_date": "2026-09-26T00:00:00Z", "timezone": "Asia/Shanghai",
        })
        assert response.status_code == 422
        assert client.get("/api/v1/entries", headers=owner).json()["items"] == []
    finally:
        client.app.state.content_review = original
        client.app.state.settings.CONTENT_REVIEW_ENABLED = original_enabled


def test_guest_text_entry_skips_content_review(entries_client):
    client, _ = entries_client
    owner = auth_headers(client, "review-skipped-guest")

    class RejectAll:
        async def check_text(self, *_):
            raise ContentReviewRejected("risky")

    original = client.app.state.content_review
    original_enabled = client.app.state.settings.CONTENT_REVIEW_ENABLED
    client.app.state.settings.CONTENT_REVIEW_ENABLED = True
    client.app.state.content_review = RejectAll()
    try:
        response = client.post("/api/v1/entries/text", headers=owner | {"Idempotency-Key": "guest-entry"}, json={
            "local_id": "guest-entry", "text": "游客的私人日记",
            "entry_date": "2026-09-26T00:00:00Z", "timezone": "Asia/Shanghai",
        })
        assert response.status_code == 201
    finally:
        client.app.state.content_review = original
        client.app.state.settings.CONTENT_REVIEW_ENABLED = original_enabled


def test_image_review_off_allows_valid_references_without_an_independent_key(entries_client):
    client, _ = entries_client
    headers = auth_headers(client, "saved-reference-review")
    entry = client.post("/api/v1/entries/text", headers=headers | {"Idempotency-Key": "saved-ref-entry"}, json={
        "local_id": "saved-ref-entry", "text": "今天在回家的路上看到了很漂亮的晚霞。",
        "entry_date": "2026-09-26T00:00:00Z", "timezone": "Asia/Shanghai",
    })
    assert entry.status_code == 201, entry.json()
    character = client.post("/api/v1/characters", headers=headers, json={
        "name": "我", "appearance_prompt": "adult in a yellow coat",
    })
    assert character.status_code == 201
    image = BytesIO()
    Image.new("RGB", (16, 16), "blue").save(image, format="PNG")
    image_bytes = image.getvalue()
    uploaded = client.post(
        f"/api/v1/characters/{character.json()['id']}/references", headers=headers,
        files={"image_file": ("front.png", image_bytes, "image/png")}, data={"kind": "front"},
    )
    assert uploaded.status_code == 201
    user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

    async def bind_wechat():
        async with client.app.state.db_session_factory() as db:
            user = await db.get(User, user_id)
            user.wechat_openid = "saved-reference-openid"
            await db.commit()

    asyncio.run(bind_wechat())

    class Review:
        image_calls = 0

        async def check_text(self, *_):
            return None

        async def check_image(self, *_):
            self.image_calls += 1
            raise ContentReviewUnavailable("independent_moderation_not_configured")

    class Queue:
        async def enqueue_job(self, *_):
            return object()

    app = client.app
    original = (app.state.content_review, app.state.settings.CONTENT_REVIEW_ENABLED,
                app.state.settings.ARQ_INLINE, app.state.arq_pool)
    review = Review()
    app.state.content_review = review
    app.state.settings.CONTENT_REVIEW_ENABLED = True
    app.state.settings.ARQ_INLINE = False
    app.state.arq_pool = Queue()
    try:
        queued = client.post(f"/api/v1/entries/{entry.json()['id']}/comic-jobs", headers=headers,
                             json={"character_id": character.json()["id"]})
        assert queued.status_code == 202
        assert review.image_calls == 0

        raw = client.post("/api/v1/jobs/comic", headers=headers, json={
            "text": "direct job accepts a structurally valid reference",
            "ref_image_b64": base64.b64encode(image_bytes).decode("ascii"),
        })
        assert raw.status_code == 202
        assert review.image_calls == 0
        invalid = client.post("/api/v1/jobs/comic", headers=headers, json={
            "text": "invalid image data must still be rejected",
            "ref_image_b64": "not-base64",
        })
        assert invalid.status_code == 415
    finally:
        (app.state.content_review, app.state.settings.CONTENT_REVIEW_ENABLED,
         app.state.settings.ARQ_INLINE, app.state.arq_pool) = original
