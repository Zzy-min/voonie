import base64
import hashlib
import io
from typing import Protocol

import httpx
from PIL import Image, ImageDraw

from voonie.backend.app.core.config import Settings
from voonie.backend.app.providers._http import request_with_retry


class ImagePromptRejectedError(RuntimeError):
    """The image provider rejected prompt content before generation."""


def _ark_error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        return str(error.get("code") or "")
    return str(body.get("code") or "") if isinstance(body, dict) else ""


class ImageProvider(Protocol):
    async def generate(
        self,
        prompt: str,
        *,
        ref_image: bytes | None,
        seed: int | None,
    ) -> bytes: ...


class MockImageProvider:
    async def generate(
        self,
        prompt: str,
        *,
        ref_image: bytes | None,
        seed: int | None,
    ) -> bytes:
        material = prompt.encode("utf-8") + (ref_image or b"") + str(seed).encode("ascii")
        digest = hashlib.sha256(material).digest()
        background = tuple(210 + component % 40 for component in digest[:3])
        accent = tuple(60 + component % 140 for component in digest[3:6])
        image = Image.new("RGB", (768, 768), background)
        draw = ImageDraw.Draw(image)
        draw.rectangle((48, 48, 720, 720), outline=accent, width=8)
        draw.ellipse((164, 150, 604, 590), outline=accent, width=12)
        draw.text((72, 680), digest.hex()[:16], fill=accent)
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=False)
        return buffer.getvalue()


class OpenAIImageProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client
        self.mock_fallback = MockImageProvider()

    async def generate(
        self,
        prompt: str,
        *,
        ref_image: bytes | None,
        seed: int | None,
    ) -> bytes:
        enhanced_prompt = prompt
        if ref_image is not None:
            enhanced_prompt = f"{prompt}\n[Reference character and scene details provided in diary context]"

        async def execute(client: httpx.AsyncClient) -> bytes:
            try:
                response = await request_with_retry(
                    client,
                    "POST",
                    f"{self.settings.OPENAI_BASE_URL.rstrip('/')}/images/generations",
                    headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                    json={
                        "model": self.settings.DEFAULT_IMAGE_MODEL,
                        "prompt": enhanced_prompt,
                        "n": 1,
                        "size": "1024x1024",
                        "quality": "standard",
                    },
                )
                item = response.json()["data"][0]
                if item.get("b64_json"):
                    return base64.b64decode(item["b64_json"], validate=True)
                if item.get("url"):
                    image_response = await request_with_retry(client, "GET", item["url"])
                    return image_response.content
                raise ValueError("Image provider response contained no image data")
            except Exception:
                if not self.settings.PRODUCTION:
                    return await self.mock_fallback.generate(enhanced_prompt, ref_image=ref_image, seed=seed)
                raise

        if self.client is not None:
            return await execute(self.client)
        async with httpx.AsyncClient(timeout=120.0) as client:
            return await execute(client)


class ArkImageProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client
        self.mock_fallback = MockImageProvider()

    async def generate(
        self,
        prompt: str,
        *,
        ref_image: bytes | None,
        seed: int | None,
    ) -> bytes:
        async def execute(client: httpx.AsyncClient) -> bytes:
            payload: dict[str, object] = {
                "model": self.settings.ARK_IMAGE_MODEL,
                "prompt": prompt,
                "size": "2K",
                "response_format": "b64_json",
                "watermark": False,
                "sequential_image_generation": "disabled",
                "stream": False,
            }
            if ref_image is not None:
                payload["image"] = [
                    f"data:image/png;base64,{base64.b64encode(ref_image).decode('ascii')}"
                ]
            try:
                response = await request_with_retry(
                    client,
                    "POST",
                    f"{self.settings.ARK_BASE_URL.rstrip('/')}/images/generations",
                    headers={"Authorization": f"Bearer {self.settings.ARK_API_KEY}"},
                    json=payload,
                )
                item = response.json()["data"][0]
                if item.get("b64_json"):
                    return base64.b64decode(item["b64_json"], validate=True)
                if item.get("url"):
                    image_response = await request_with_retry(client, "GET", item["url"])
                    return image_response.content
                raise ValueError("Ark image provider response contained no image data")
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 400 and _ark_error_code(exc.response) in {
                    "InputTextSensitiveContentDetected",
                    "SensitiveContentDetected",
                    "50412",
                    "50413",
                }:
                    raise ImagePromptRejectedError("image_prompt_rejected") from exc
                if not self.settings.PRODUCTION:
                    return await self.mock_fallback.generate(prompt, ref_image=ref_image, seed=seed)
                raise
            except Exception:
                if not self.settings.PRODUCTION:
                    return await self.mock_fallback.generate(prompt, ref_image=ref_image, seed=seed)
                raise

        if self.client is not None:
            return await execute(self.client)
        async with httpx.AsyncClient(timeout=180.0) as client:
            return await execute(client)


def get_image_provider(settings: Settings, client: httpx.AsyncClient | None = None) -> ImageProvider:
    if settings.ARK_API_KEY:
        return ArkImageProvider(settings, client)
    if settings.OPENAI_API_KEY:
        return OpenAIImageProvider(settings, client)
    return MockImageProvider()
