import hashlib
import math
from typing import Protocol

import httpx

from voonie.backend.app.core.config import Settings
from voonie.backend.app.providers._http import request_with_retry


class EmbeddingProvider(Protocol):
    async def embed(self, text: str) -> list[float]: ...


class MockEmbeddingProvider:
    async def embed(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        values = [float(byte - 127) for byte in digest]
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [value / norm for value in values]


class OpenAIEmbeddingProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    async def embed(self, text: str) -> list[float]:
        async def execute(client: httpx.AsyncClient) -> list[float]:
            response = await request_with_retry(
                client,
                "POST",
                f"{self.settings.OPENAI_BASE_URL.rstrip('/')}/embeddings",
                headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                json={"model": self.settings.DEFAULT_EMBEDDING_MODEL, "input": text},
            )
            return [float(value) for value in response.json()["data"][0]["embedding"]]

        if self.client is not None:
            return await execute(self.client)
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await execute(client)


def get_embedding_provider(
    settings: Settings,
    client: httpx.AsyncClient | None = None,
) -> EmbeddingProvider:
    if settings.OPENAI_API_KEY:
        return OpenAIEmbeddingProvider(settings, client)
    return MockEmbeddingProvider()

