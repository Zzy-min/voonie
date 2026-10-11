import asyncio
from io import BytesIO

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from test_jobs import auth_headers, jobs_client, wait_for_job
from voonie.backend.app.core.config import Settings
from voonie.backend.app.providers.image import ArkImageProvider, MockImageProvider
from voonie.backend.app.schemas.jobs import EntryComicJobRequest


def png(color="red"):
    buffer = BytesIO()
    Image.new("RGB", (64, 48), color).save(buffer, format="PNG")
    return buffer.getvalue()


def entry(client, headers, key):
    res = client.post("/api/v1/entries/text", headers={**headers, "Idempotency-Key": key}, json={
        "local_id": key, "text": "今天去公园散步，看到花朵。\n\n下午和朋友喝茶。\n\n晚上读了一本书。",
        "entry_date": "2026-10-02T12:00:00+08:00", "timezone": "Asia/Shanghai",
    })
    assert res.status_code == 201, res.text
    return res.json()["id"]


def upload(client, headers, entry_id, include=True):
    res = client.post(f"/api/v1/entries/{entry_id}/references", headers=headers,
        data={"reference_type": "scene", "include_in_content": str(include).lower()},
        files={"image_file": ("reference.png", png(), "image/png")})
    assert res.status_code == 201, res.text
    return res.json()


def test_three_references_survive_generation_and_diary_response(jobs_client):
    owner = auth_headers(jobs_client, "three-reference-owner")
    entry_id = entry(jobs_client, owner, "three-reference-entry")
    refs = [upload(jobs_client, owner, entry_id, index != 1) for index in range(3)]

    class CapturingImage(MockImageProvider):
        received = []
        async def generate(self, prompt, *, ref_image, seed, ref_images=None):
            self.received.append(ref_images)
            return await super().generate(prompt, ref_image=ref_image, seed=seed, ref_images=ref_images)

    provider = CapturingImage()
    jobs_client.app.state.image_service.provider = provider
    res = jobs_client.post(f"/api/v1/entries/{entry_id}/comic-jobs", headers={**owner, "Idempotency-Key": "three-ref-job"},
        json={"reference_ids": [item["id"] for item in refs]})
    assert res.status_code == 202, res.text
    job_id = res.json()["job_id"]
    assert wait_for_job(jobs_client, job_id, owner)["status"] == "done"
    assert len(provider.received[0]) == 3
    diary = jobs_client.get(f"/api/v1/diaries/{job_id}", headers=owner).json()
    assert [ref["id"] for ref in diary["reference_images"]] == [ref["id"] for ref in refs]
    assert [ref["include_in_content"] for ref in diary["reference_images"]] == [True, False, True]
    assert all("image_b64" not in ref for ref in diary["reference_images"])
    # Idempotent replay must recover the same generation task.
    replay = jobs_client.post(f"/api/v1/entries/{entry_id}/comic-jobs", headers={**owner, "Idempotency-Key": "three-ref-job"}, json={"reference_ids": [item["id"] for item in refs]})
    assert replay.json()["job_id"] == job_id
    recovered = jobs_client.get("/api/v1/jobs/by-key/three-ref-job", headers=owner)
    assert recovered.status_code == 200
    assert recovered.json()["job_id"] == job_id
    other = auth_headers(jobs_client, "three-reference-stranger")
    assert jobs_client.get("/api/v1/jobs/by-key/three-ref-job", headers=other).status_code == 404


def test_reference_limits_legacy_and_duplicate_validation():
    assert EntryComicJobRequest(reference_id="a").reference_id == "a"
    assert EntryComicJobRequest(reference_ids=[]).reference_ids == []
    for ids in (["a"] * 2, ["a", "b", "c", "d"], [""], ["a" * 37]):
        with pytest.raises(ValidationError):
            EntryComicJobRequest(reference_ids=ids)


def test_stored_reference_does_not_bypass_raw_reference_validation(jobs_client):
    owner = auth_headers(jobs_client, "mixed-reference-owner")
    entry_id = entry(jobs_client, owner, "mixed-reference-entry")
    ref = upload(jobs_client, owner, entry_id)
    res = jobs_client.post(f"/api/v1/entries/{entry_id}/comic-jobs", headers=owner,
        json={"reference_ids": [ref["id"]], "ref_image_b64": "not valid base64"})
    assert res.status_code == 415


def test_references_cannot_cross_users_or_entries(jobs_client):
    owner = auth_headers(jobs_client, "reference-isolation-owner")
    other = auth_headers(jobs_client, "reference-isolation-other")
    first = entry(jobs_client, owner, "reference-first")
    second = entry(jobs_client, other, "reference-other")
    reference = upload(jobs_client, other, second)
    res = jobs_client.post(f"/api/v1/entries/{first}/comic-jobs", headers=owner, json={"reference_ids": [reference["id"]]})
    assert res.status_code == 404


def test_thumbnail_keeps_private_access(jobs_client):
    owner = auth_headers(jobs_client, "thumbnail-owner")
    other = auth_headers(jobs_client, "thumbnail-other")
    ref = upload(jobs_client, owner, entry(jobs_client, owner, "thumbnail-entry"))
    url = ref["image_url"] + "?thumbnail=true"
    assert jobs_client.get(url, headers=other).status_code == 404
    result = jobs_client.get(url, headers=owner)
    assert result.status_code == 200
    assert result.headers["content-type"] == "image/jpeg"
    assert Image.open(BytesIO(result.content)).size == (64, 48)


def test_ark_sends_all_reference_images():
    import json
    payloads = []
    def handle(req):
        payloads.append(json.loads(req.content))
        import base64
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            provider = ArkImageProvider(Settings(_env_file=None, ARK_API_KEY="test", JWT_SECRET="test-only-unique-production-key-123456", COOKIE_SECURE=True, OPENAI_API_KEY="test", PRODUCTION=True), client)
            return await provider.generate("a garden", ref_image=png("green"), seed=1, ref_images=[png(), png("blue")])
    assert asyncio.run(run())
    assert len(payloads[0]["image"]) == 3
