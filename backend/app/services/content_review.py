"""Private, server-side moderation used before content is processed or shown."""

import base64

import httpx

from voonie.backend.app.core.config import Settings
from voonie.backend.app.services.wechat_content_safety import (
    ContentReviewRejected, ContentReviewUnavailable, WechatContentSafety,
)


class ContentReview:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client
        self.wechat = WechatContentSafety(settings, client)

    async def _openai_check(self, content: str | list[dict]) -> None:
        if not self.settings.OPENAI_API_KEY:
            raise ContentReviewUnavailable("independent_moderation_not_configured")
        try:
            response = await self.client.post(
                "https://api.openai.com/v1/moderations",
                headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                json={"model": "omni-moderation-latest", "input": content},
                timeout=20.0,
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ContentReviewUnavailable("independent_moderation_unavailable") from exc
        if not isinstance(payload, dict):
            raise ContentReviewUnavailable("independent_moderation_missing_result")
        results = payload.get("results")
        if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict) or not isinstance(results[0].get("flagged"), bool):
            raise ContentReviewUnavailable("independent_moderation_missing_result")
        if results[0]["flagged"]:
            raise ContentReviewRejected("review")

    async def check_text(self, content: str, openid: str | None = None) -> None:
        if not self.settings.CONTENT_REVIEW_ENABLED or not content.strip():
            return
        if openid and self.settings.WECHAT_CONTENT_REVIEW_ENABLED:
            try:
                await self.wechat.check_text(content, openid)
                return
            except ContentReviewUnavailable:
                if not self.settings.OPENAI_API_KEY:
                    raise
                # A configured independent provider may cover a stale WeChat
                # visit or temporary WeChat API failure; it is never silent.
        if not self.settings.OPENAI_API_KEY:
            raise ContentReviewUnavailable("content_review_provider_unavailable")
        for offset in range(0, len(content), 2500):
            chunk = content[offset:offset + 2500]
            await self._openai_check(chunk)

    async def check_image(self, data: bytes, mime_type: str = "image/png") -> None:
        if not self.settings.IMAGE_CONTENT_REVIEW_ENABLED:
            return
        if mime_type not in {"image/png", "image/jpeg", "image/gif", "image/webp"}:
            raise ContentReviewUnavailable("unsupported_moderation_image_type")
        encoded = base64.b64encode(data).decode("ascii")
        await self._openai_check([
            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}},
        ])
