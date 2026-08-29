"""Controlled mock-provider concurrency checks for chat and illustration jobs."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
import uuid
from pathlib import Path

import httpx


def p(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(len(ordered) * quantile) - 1)] if ordered else 0.0


def metrics(name: str, concurrency: int, latencies: list[float], statuses: list[int]) -> dict:
    return {
        "name": name,
        "concurrency": concurrency,
        "requests": len(latencies),
        "p50_ms": round(statistics.median(latencies), 2),
        "p95_ms": round(p(latencies, 0.95), 2),
        "p99_ms": round(p(latencies, 0.99), 2),
        "error_rate": round(sum(code < 200 or code >= 300 for code in statuses) / len(statuses), 4),
        "statuses": {str(code): statuses.count(code) for code in sorted(set(statuses))},
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8011")
    parser.add_argument("--output", default="backend/.pytest-data/provider-load-results.json")
    args = parser.parse_args()
    limits = httpx.Limits(max_connections=100, max_keepalive_connections=50)
    async with httpx.AsyncClient(base_url=args.base_url, timeout=30, limits=limits) as client:
        users = []
        for index in range(50):
            response = await client.post("/api/v1/auth/device", json={
                "device_id": f"provider-load-{uuid.uuid4().hex}-{index}",
                "app_version": "provider-load",
            })
            response.raise_for_status()
            users.append({"Authorization": f"Bearer {response.json()['access_token']}"})

        chat_results = []
        for concurrency in (1, 3, 5, 10, 20):
            latencies: list[float] = []
            statuses: list[int] = []
            semaphore = asyncio.Semaphore(concurrency)

            async def chat(
                index: int,
                stage_semaphore: asyncio.Semaphore,
                stage_latencies: list[float],
                stage_statuses: list[int],
            ) -> None:
                async with stage_semaphore:
                    started = time.perf_counter()
                    response = await client.post(
                        "/api/v1/pet/chat",
                        headers=users[index % len(users)],
                        json={"message": "今天完成了接口压力测试，想简单聊聊。"},
                    )
                    stage_latencies.append((time.perf_counter() - started) * 1000)
                    stage_statuses.append(response.status_code)

            await asyncio.gather(*(
                chat(index, semaphore, latencies, statuses)
                for index in range(max(5, concurrency * 3))
            ))
            chat_results.append(metrics("chat", concurrency, latencies, statuses))

        illustration_results = []
        for concurrency in (1, 2, 5, 10):
            latencies: list[float] = []
            statuses: list[int] = []

            async def illustrate(
                index: int,
                stage_latencies: list[float],
                stage_statuses: list[int],
            ) -> None:
                started = time.perf_counter()
                response = await client.post(
                    "/api/v1/jobs/comic",
                    headers=users[index] | {"Idempotency-Key": f"provider-image-{uuid.uuid4().hex}"},
                    json={"text": f"第 {index} 个受控插图任务，傍晚看见了温暖的晚霞。"},
                )
                if response.status_code == 202:
                    job_id = response.json()["job_id"]
                    for _ in range(300):
                        job = await client.get(f"/api/v1/jobs/{job_id}", headers=users[index])
                        if job.json()["status"] in {"done", "failed", "cancelled"}:
                            response = job
                            break
                        await asyncio.sleep(0.02)
                stage_latencies.append((time.perf_counter() - started) * 1000)
                stage_statuses.append(response.status_code)

            await asyncio.gather(*(
                illustrate(index, latencies, statuses) for index in range(concurrency)
            ))
            illustration_results.append(metrics("illustration", concurrency, latencies, statuses))

    result = {"provider_mode": "mock-only", "chat": chat_results, "illustration": illustration_results}
    Path(args.output).write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
