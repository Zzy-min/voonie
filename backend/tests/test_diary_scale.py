import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import time
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import event

from voonie.backend.app.core.config import Settings
from voonie.backend.app.db.models import Base, DiaryArtifact, DiaryEntry, Job
from voonie.backend.app.main import create_app


def test_diary_history_handles_one_hundred_records_without_n_plus_one_queries():
    data_dir = Path("voonie/backend/.pytest-data")
    data_dir.mkdir(exist_ok=True)
    database_path = data_dir / f"diary-scale-{uuid.uuid4().hex}.db"
    app = create_app(Settings(
        DATABASE_URL=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        JWT_SECRET="scale-test-secret-that-is-long-enough",
        ARQ_INLINE=True,
        TESTING=False,
    ))

    async def create_schema():
        async with app.state.db_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    asyncio.run(create_schema())
    try:
        with TestClient(app) as client:
            auth = client.post("/api/v1/auth/device", json={"device_id": "scale-device-100", "app_version": "1.0"})
            headers = {"Authorization": f"Bearer {auth.json()['access_token']}"}
            user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]

            async def seed():
                async with app.state.db_session_factory() as db:
                    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
                    for index in range(100):
                        entry_id = str(uuid.uuid4())
                        job_id = str(uuid.uuid4())
                        entry = DiaryEntry(
                            id=entry_id, user_id=user_id, local_id=f"scale-{index}", entry_date=start + timedelta(days=index),
                            timezone="Asia/Shanghai", input_type="text", redacted_text=f"第 {index + 1} 篇记录",
                            emotion_json={}, event_json={}, status="confirmed",
                        )
                        job = Job(
                            id=job_id, user_id=user_id, type="comic", status="done", stage="done", progress=1,
                            request_json={"entry_id": entry_id, "text": entry.redacted_text},
                            result_json={
                                "entry_id": entry_id, "title": f"第 {index + 1} 篇",
                                "organized_diary": entry.redacted_text, "raw_transcript": entry.redacted_text,
                                "emotion": {"primary_emotion": "calm", "emotion_label_zh": "平静", "mood_score": 6, "analysis": ""},
                                "panels": [], "companion_note": "已记录",
                            },
                        )
                        artifact = DiaryArtifact(
                            user_id=user_id, job_id=job_id, entry_id=entry_id, title=f"第 {index + 1} 篇",
                            emotion_label="平静", mood_score=6, companion_note="已记录",
                        )
                        db.add_all([entry, job, artifact])
                    await db.commit()

            asyncio.run(seed())
            started = time.perf_counter()
            query_count = 0
            count_queries = True

            def count_statement(*_args):
                nonlocal query_count
                if count_queries:
                    query_count += 1

            event.listen(app.state.db_engine.sync_engine, "before_cursor_execute", count_statement)
            response = client.get("/api/v1/diaries", headers=headers)
            count_queries = False
            elapsed = time.perf_counter() - started

            assert response.status_code == 200
            assert len(response.json()) == 100
            assert response.json()[0]["entry_date"] is not None
            # One authentication lookup plus one joined diary query; record count must not add queries.
            assert query_count == 2
            assert elapsed < 3.0

            for page_size in (10, 50, 100):
                paged = client.get(f"/api/v1/diaries?limit={page_size}&offset=0", headers=headers)
                assert paged.status_code == 200
                assert len(paged.json()) == page_size

            second_page = client.get("/api/v1/diaries?limit=10&offset=10", headers=headers)
            assert second_page.status_code == 200
            assert len(second_page.json()) == 10
            assert {item["job_id"] for item in second_page.json()}.isdisjoint(
                {item["job_id"] for item in response.json()[:10]}
            )

            ranged = client.get(
                "/api/v1/diaries",
                headers=headers,
                params={
                    "start_date": "2026-01-10T00:00:00Z",
                    "end_date": "2026-01-19T23:59:59Z",
                },
            )
            assert ranged.status_code == 200
            assert len(ranged.json()) == 10
            assert all("2026-01-10" <= item["entry_date"][:10] <= "2026-01-19" for item in ranged.json())

            equivalent_offset_range = client.get(
                "/api/v1/diaries",
                headers=headers,
                params={
                    "start_date": "2026-01-10T08:00:00+08:00",
                    "end_date": "2026-01-20T07:59:59+08:00",
                },
            )
            assert equivalent_offset_range.status_code == 200
            assert len(equivalent_offset_range.json()) == 10

            naive_date = client.get(
                "/api/v1/diaries",
                headers=headers,
                params={"start_date": "2026-01-10T00:00:00"},
            )
            assert naive_date.status_code == 422

            reversed_range = client.get(
                "/api/v1/diaries",
                headers=headers,
                params={
                    "start_date": "2026-01-20T00:00:00Z",
                    "end_date": "2026-01-10T00:00:00Z",
                },
            )
            assert reversed_range.status_code == 422
    finally:
        asyncio.run(app.state.db_engine.dispose())
        database_path.unlink(missing_ok=True)
