import asyncio
import io
from pathlib import Path
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base
from voonie.backend.app.main import create_app
from voonie.backend.app.models.schemas import CharacterConfig, ComicPanel
from voonie.backend.app.services.prompt_builder import build_panel_prompt
from voonie.backend.app.workers.storybook_job import page_count_for


@pytest.fixture
def mvp_client():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    test_id = uuid.uuid4().hex
    database_path = data_dir / f"mvp-{test_id}.db"
    media_dir = data_dir / f"mvp-media-{test_id}"
    app = create_app(Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="mvp-test-secret-that-is-long-enough",
        TEMP_MEDIA_DIR=media_dir,
        ARQ_INLINE=True,
        TESTING=False,
    ))

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    with TestClient(app) as client:
        yield client
    asyncio.run(app.state.db_engine.dispose())
    database_path.unlink(missing_ok=True)
    if media_dir.exists():
        for item in media_dir.iterdir():
            item.unlink()
        media_dir.rmdir()


def auth_headers(client: TestClient, device: str) -> dict[str, str]:
    response = client.post("/api/v1/auth/device", json={"device_id": device, "app_version": "1.0.0"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def wait_for_job(client: TestClient, job_id: str, headers: dict[str, str]) -> dict:
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/jobs/{job_id}", headers=headers)
        body = response.json()
        if body["status"] in {"done", "failed"}:
            return body
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def png_bytes() -> bytes:
    image = Image.new("RGB", (32, 32), (240, 180, 80))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def create_entry(client: TestClient, headers: dict[str, str], local_id: str, text: str, when: str) -> str:
    response = client.post(
        "/api/v1/entries/text",
        headers=headers | {"Idempotency-Key": local_id},
        json={"local_id": local_id, "text": text, "entry_date": when, "timezone": "Asia/Shanghai"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_prompt_builder_locks_character_traits():
    prompt = build_panel_prompt(
        ComicPanel(
            panel_id=1,
            scene_desc="a rainy street",
            character_action="holding an umbrella",
            source_excerpt="晚上回家时下起了大雨。",
        ),
        CharacterConfig(),
        "chibi manga",
        {"hair": "short brown hair", "outfit": "yellow hoodie", "locked": ["hairstyle", "main outfit color"]},
    )
    assert "Keep locked traits unchanged: hairstyle, main outfit color" in prompt
    assert "Source-grounded memory: 晚上回家时下起了大雨。" in prompt
    assert "time of day, weather, location, objects, and lighting" in prompt
    assert "No speech balloons" in prompt


def test_page_count_follows_confirmed_entry_volume():
    assert page_count_for(0) == 0
    assert page_count_for(1) == 4
    assert page_count_for(3) == 4
    assert page_count_for(4) == 6
    assert page_count_for(8) == 8


def test_entry_comic_job_and_single_panel_retry(mvp_client):
    headers = auth_headers(mvp_client, "mvp-comic")
    entry_id = create_entry(
        mvp_client,
        headers,
        "comic-entry",
        "今天上午开会时有点紧张，准备的内容没有讲好，我低落了很久。中午一个人吃了面，慢慢平静下来。下午老师夸了我的作业，回家路上又看到橙色晚霞，心情终于亮了起来。晚上回家以后，我又把今天的事情慢慢想了一遍，觉得那些小小的变化都值得记下来。",
        "2026-08-27T10:00:00Z",
    )
    created = mvp_client.post(f"/api/v1/entries/{entry_id}/comic-jobs", headers=headers)
    assert created.status_code == 202
    completed = wait_for_job(mvp_client, created.json()["job_id"], headers)
    assert completed["status"] == "done"
    artifact_id = completed["result"]["artifact_id"]
    artifact = mvp_client.get(f"/api/v1/artifacts/{artifact_id}", headers=headers)
    assert artifact.status_code == 200
    assert len(artifact.json()["panels"]) == 2
    original_keys = artifact.json()["panels"]

    retry = mvp_client.post(f"/api/v1/artifacts/{artifact_id}/panels/2/retry", headers=headers)
    retried = wait_for_job(mvp_client, retry.json()["job_id"], headers)
    assert retried["status"] == "done"
    updated = mvp_client.get(f"/api/v1/artifacts/{artifact_id}", headers=headers).json()
    assert updated["panels"][1]["retry_count"] == 1
    assert updated["panels"][0]["storyboard"] == original_keys[0]["storyboard"]


def test_character_snapshot_survives_later_edits(mvp_client):
    headers = auth_headers(mvp_client, "mvp-character")
    created = mvp_client.post("/api/v1/characters", headers=headers, json={
        "name": "小夏",
        "appearance_prompt": "a girl with brown bob hair and yellow hoodie",
        "bible": {"hair": "brown bob", "outfit": "yellow hoodie", "locked": ["hairstyle", "main outfit color"]},
    })
    character_id = created.json()["id"]
    listed = mvp_client.get("/api/v1/characters", headers=headers)
    assert [item["id"] for item in listed.json()] == [character_id]
    upload = mvp_client.post(
        f"/api/v1/characters/{character_id}/references",
        headers=headers,
        files={"image_file": ("front.png", png_bytes(), "image/png")},
        data={"kind": "front"},
    )
    assert upload.status_code == 201
    reference_id = upload.json()["id"]
    entry_id = create_entry(mvp_client, headers, "char-entry", "今天把人物卡定下来了。", "2026-08-27T12:00:00Z")
    job = mvp_client.post(
        f"/api/v1/entries/{entry_id}/comic-jobs",
        headers=headers,
        json={"text": "ignored", "character": {"character_name": "小夏", "appearance_prompt": "a girl with brown bob hair and yellow hoodie"}},
    )
    completed = wait_for_job(mvp_client, job.json()["job_id"], headers)
    artifact_id = completed["result"]["artifact_id"]
    mvp_client.patch(f"/api/v1/characters/{character_id}", headers=headers, json={"appearance_prompt": "completely different red coat"})
    artifact = mvp_client.get(f"/api/v1/artifacts/{artifact_id}", headers=headers).json()
    assert "yellow hoodie" in artifact["character_snapshot"]["appearance_prompt"]
    assert "red coat" not in artifact["character_snapshot"]["appearance_prompt"]
    assert mvp_client.delete(
        f"/api/v1/characters/{character_id}/references/{reference_id}", headers=headers
    ).status_code == 204


def test_daily_storybook_versions_and_empty_day(mvp_client):
    headers = auth_headers(mvp_client, "mvp-daily")
    empty = mvp_client.get("/api/v1/daily-diaries/2026-08-27?timezone=Asia/Shanghai", headers=headers)
    assert empty.status_code == 200
    create_entry(mvp_client, headers, "day-1", "早晨喝了咖啡。", "2026-08-26T16:10:00Z")
    create_entry(mvp_client, headers, "day-2", "中午有点烦，但晚上看到晚霞。", "2026-08-26T16:40:00Z")
    create_entry(mvp_client, headers, "day-3", "睡前把今天的事说完了。", "2026-08-26T17:20:00Z")
    create_entry(mvp_client, headers, "day-4", "后来又补记了一件小事。", "2026-08-26T17:50:00Z")
    summary = mvp_client.post("/api/v1/daily-diaries/2026-08-27/summary-jobs?timezone=Asia/Shanghai", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["status"] == "ready"
    edited = mvp_client.patch(
        "/api/v1/daily-diaries/2026-08-27?timezone=Asia/Shanghai",
        headers=headers,
        json={"summary": "确认后的每日摘要。"},
    )
    assert edited.json()["summary"] == "确认后的每日摘要。"
    first = mvp_client.post("/api/v1/daily-diaries/2026-08-27/storybook-jobs?timezone=Asia/Shanghai", headers=headers)
    first_job = wait_for_job(mvp_client, first.json()["job_id"], headers)
    assert first_job["status"] == "done"
    assert first_job["result"]["page_count"] == 6
    second = mvp_client.post("/api/v1/daily-diaries/2026-08-27/storybook-jobs?timezone=Asia/Shanghai", headers=headers)
    second_job = wait_for_job(mvp_client, second.json()["job_id"], headers)
    assert second_job["result"]["version"] == 2
    assert second_job["result"]["artifact_id"] != first_job["result"]["artifact_id"]


def test_prompt_builder_dog_consistency_and_ref_image():
    # Test dog consistency
    prompt_dog = build_panel_prompt(
        ComicPanel(panel_id=2, scene_desc="park bench", character_action="petting the dog happily"),
        CharacterConfig(),
        "chibi manga",
    )
    assert "Companion Pet: a cute cheerful fluffy orange-and-white puppy named Voonie" in prompt_dog

    # Test reference image condition
    prompt_ref = build_panel_prompt(
        ComicPanel(panel_id=3, scene_desc="sunset hill", character_action="watching the sky"),
        CharacterConfig(),
        "chibi manga",
        use_ref=True,
    )
    assert "【STRICT VISUAL REFERENCE】" in prompt_ref


def test_diary_single_panel_regeneration(mvp_client):
    headers = auth_headers(mvp_client, "mvp-panel-regen")
    gen_response = mvp_client.post(
        "/api/v1/diaries/text-generate",
        headers=headers,
        json={"text": "今天上午去公园散步，小狗在草地上跑得很欢快，我站在树荫下看了它很久。后来遇到一位朋友，我们聊了最近的生活。晚上回到家喝了一杯热牛奶，终于觉得整个人慢慢放松了下来。"},
    )
    assert gen_response.status_code == 200
    diary = gen_response.json()
    job_id = diary["job_id"]
    old_panel2_url = diary["panels"][1]["image_url"]
    original_created_at = diary["created_at"]

    # Regenerate panel 2
    regen_response = mvp_client.post(
        f"/api/v1/diaries/{job_id}/panels/2/regenerate",
        headers=headers,
        json={"custom_prompt": "阳光更耀眼，小狗在草地上打滚"},
    )
    assert regen_response.status_code == 200
    updated = regen_response.json()
    assert len(updated["panels"]) == 2
    assert updated["panels"][1]["image_url"] != old_panel2_url
    assert updated["created_at"] == original_created_at
