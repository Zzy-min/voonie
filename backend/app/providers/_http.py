import asyncio
from typing import Any

import httpx


async def request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    attempts: int = 3,
    **kwargs: Any,
) -> httpx.Response:
    for attempt in range(attempts):
        try:
            response = await client.request(method, url, **kwargs)
        except httpx.TransportError:
            if attempt >= attempts - 1:
                raise
            await asyncio.sleep(0.25 * (2**attempt))
            continue
        retryable = response.status_code == 429 or response.status_code >= 500
        if retryable and attempt < attempts - 1:
            await asyncio.sleep(0.25 * (2**attempt))
            continue
        response.raise_for_status()
        return response
    raise RuntimeError("HTTP retry loop exited unexpectedly")
