"""Controlled Voonie HTTP load test for an isolated local test server.

The workload intentionally excludes paid provider calls. It exercises real HTTP,
authentication, validation, SQLAlchemy and SQLite persistence through public APIs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
import uuid
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx


@dataclass
class StageResult:
    name: str
    concurrency: int
    requests: int
    duration_s: float
    rps: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    error_rate: float
    statuses: dict[str, int]


def percentile(values: list[float], percentile_value: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, math.ceil(percentile_value * len(ordered)) - 1)
    return ordered[index]


async def create_users(client: httpx.AsyncClient, count: int) -> list[dict[str, str]]:
    users = []
    for index in range(count):
        response = await client.post(
            "/api/v1/auth/device",
            json={"device_id": f"load-user-{uuid.uuid4().hex}-{index}", "app_version": "load-test"},
        )
        response.raise_for_status()
        users.append({"Authorization": f"Bearer {response.json()['access_token']}"})
    return users


async def seed_entries(client: httpx.AsyncClient, users: list[dict[str, str]]) -> None:
    for index, headers in enumerate(users):
        local_id = f"load-seed-{uuid.uuid4().hex}"
        response = await client.post(
            "/api/v1/entries/text",
            headers=headers | {"Idempotency-Key": local_id},
            json={
                "local_id": local_id,
                "text": f"负载测试用户 {index} 的隔离日记，今天完成了一次稳定性验证。",
                "entry_date": "2026-08-30T10:00:00+08:00",
                "timezone": "Asia/Shanghai",
            },
        )
        response.raise_for_status()


async def run_stage(
    client: httpx.AsyncClient,
    users: list[dict[str, str]],
    name: str,
    concurrency: int,
    request_count: int,
) -> StageResult:
    semaphore = asyncio.Semaphore(concurrency)
    latencies: list[float] = []
    statuses: Counter[str] = Counter()

    async def one(index: int) -> None:
        headers = users[index % len(users)]
        selector = index % 20
        if selector < 9:
            method, path, kwargs = "GET", "/api/v1/entries?limit=20", {}
        elif selector < 14:
            method, path, kwargs = "GET", "/api/v1/diaries", {}
        elif selector < 17:
            method, path, kwargs = "GET", "/api/v1/auth/me", {}
        elif selector < 19:
            method, path, kwargs = "GET", "/api/v1/me/preferences", {}
        else:
            local_id = f"load-write-{name}-{index}-{uuid.uuid4().hex}"
            method, path = "POST", "/api/v1/entries/text"
            kwargs = {
                "headers": headers | {"Idempotency-Key": local_id},
                "json": {
                    "local_id": local_id,
                    "text": "并发负载中的真实日记写入，包含中文、emoji 🌇 与换行。\n第二段。",
                    "entry_date": "2026-08-30T11:00:00+08:00",
                    "timezone": "Asia/Shanghai",
                },
            }
        kwargs.setdefault("headers", headers)
        async with semaphore:
            started = time.perf_counter()
            try:
                response = await client.request(method, path, **kwargs)
                statuses[str(response.status_code)] += 1
            except httpx.HTTPError as exc:  # load harness must count transport failures
                statuses[f"transport:{type(exc).__name__}"] += 1
            finally:
                latencies.append((time.perf_counter() - started) * 1000)

    started = time.perf_counter()
    await asyncio.gather(*(one(index) for index in range(request_count)))
    duration = time.perf_counter() - started
    errors = sum(count for status, count in statuses.items() if not status.startswith("2"))
    return StageResult(
        name=name,
        concurrency=concurrency,
        requests=request_count,
        duration_s=round(duration, 3),
        rps=round(request_count / duration, 2),
        p50_ms=round(statistics.median(latencies), 2),
        p95_ms=round(percentile(latencies, 0.95), 2),
        p99_ms=round(percentile(latencies, 0.99), 2),
        error_rate=round(errors / request_count, 4),
        statuses=dict(statuses),
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8011")
    parser.add_argument("--output", default="backend/.pytest-data/api-load-results.json")
    args = parser.parse_args()
    limits = httpx.Limits(max_connections=300, max_keepalive_connections=100)
    async with httpx.AsyncClient(base_url=args.base_url, timeout=20, limits=limits) as client:
        users = await create_users(client, 50)
        await seed_entries(client, users)
        stages = []
        for concurrency in (1, 10, 25, 50, 100, 200):
            request_count = max(100, concurrency * 5)
            stages.append(await run_stage(client, users, f"gradual-{concurrency}", concurrency, request_count))
        stages.append(await run_stage(client, users, "spike-up", 100, 500))
        stages.append(await run_stage(client, users, "spike-recovery", 10, 100))
        stages.append(await run_stage(client, users, "short-soak", 25, 1000))

    payload = {
        "generated_at_epoch": time.time(),
        "provider_mode": "mock-only",
        "test_users": len(users),
        "stages": [asdict(stage) for stage in stages],
    }
    Path(args.output).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
