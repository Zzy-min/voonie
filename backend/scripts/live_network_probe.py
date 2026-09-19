"""Low-risk availability probe for public health endpoints."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from collections import Counter
from pathlib import Path

import httpx


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    return ordered[min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1)]


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://vonnie.xyz/health/ready")
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    semaphore = asyncio.Semaphore(max(1, min(args.concurrency, 20)))
    latencies: list[float] = []
    statuses: Counter[str] = Counter()

    async with httpx.AsyncClient(timeout=10) as client:
        async def probe() -> None:
            async with semaphore:
                started = time.perf_counter()
                try:
                    response = await client.get(args.url, headers={"Cache-Control": "no-cache"})
                    statuses[str(response.status_code)] += 1
                except httpx.HTTPError as exc:
                    statuses[f"transport:{type(exc).__name__}"] += 1
                finally:
                    latencies.append((time.perf_counter() - started) * 1000)

        started = time.perf_counter()
        await asyncio.gather(*(probe() for _ in range(args.requests)))
        duration = time.perf_counter() - started

    errors = sum(count for status, count in statuses.items() if not status.startswith("2"))
    payload = {
        "url": args.url,
        "requests": args.requests,
        "concurrency": args.concurrency,
        "duration_s": round(duration, 3),
        "rps": round(args.requests / duration, 2),
        "statuses": dict(statuses),
        "error_rate": round(errors / args.requests, 4),
        "latency_ms": {
            "p50": round(statistics.median(latencies), 2),
            "p90": round(percentile(latencies, 0.90), 2),
            "p95": round(percentile(latencies, 0.95), 2),
            "p99": round(percentile(latencies, 0.99), 2),
            "max": round(max(latencies, default=0), 2),
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
