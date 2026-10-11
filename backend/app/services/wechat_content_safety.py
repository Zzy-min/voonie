"""Server-side WeChat content review. Never send credentials to a mini program."""

import asyncio
import time

import httpx

from voonie.backend.app.core.config import Settings


class ContentReviewUnavailable(Exception):
    pass


class ContentReviewRejected(Exception):
    def __init__(self, suggestion: str, label: int | None = None):
        self.suggestion = suggestion
        self.label = label
        super().__init__(suggestion)


class WechatContentSafety:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    async def _access_token(self) -> str:
        if self._token and time.monotonic() < self._token_expires_at:
            return self._token
        async with self._token_lock:
            if self._token and time.monotonic() < self._token_expires_at:
                return self._token
            if not self.settings.WECHAT_APP_ID or not self.settings.WECHAT_APP_SECRET:
                raise ContentReviewUnavailable("wechat_credentials_missing")
            try:
                response = await self.client.get(
                    "https://api.weixin.qq.com/cgi-bin/token",
                    params={"grant_type": "client_credential", "appid": self.settings.WECHAT_APP_ID,
                            "secret": self.settings.WECHAT_APP_SECRET},
                    timeout=8.0,
                )
                response.raise_for_status()
                payload = response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise ContentReviewUnavailable("wechat_token_unavailable") from exc
            if not isinstance(payload, dict) or payload.get("errcode", 0) != 0 or not payload.get("access_token"):
                raise ContentReviewUnavailable("wechat_token_unavailable")
            self._token = payload["access_token"]
            self._token_expires_at = time.monotonic() + max(0, int(payload.get("expires_in", 7200)) - 120)
            return self._token

    async def check_text(self, content: str, openid: str, *, scene: int = 4) -> None:
        if not openid:
            raise ContentReviewUnavailable("wechat_openid_missing")
        # WeChat limits each request to 2,500 characters. Check every chunk;
        # never silently truncate a long diary or AI response.
        for offset in range(0, len(content), 2500):
            chunk = content[offset:offset + 2500]
            for attempt in range(2):
                token = await self._access_token()
                try:
                    response = await self.client.post(
                        "https://api.weixin.qq.com/wxa/msg_sec_check",
                        params={"access_token": token},
                        json={"content": chunk, "version": 2, "scene": scene, "openid": openid},
                        timeout=10.0,
                    )
                    response.raise_for_status()
                    payload = response.json()
                except (httpx.HTTPError, ValueError) as exc:
                    raise ContentReviewUnavailable("wechat_text_check_unavailable") from exc
                if isinstance(payload, dict) and payload.get("errcode") == 40001 and attempt == 0:
                    # Another server-side caller may have refreshed this app's
                    # token. Fetch the latest token and retry this chunk once.
                    async with self._token_lock:
                        if self._token == token:
                            self._token = None
                            self._token_expires_at = 0.0
                    continue
                break
            if not isinstance(payload, dict):
                raise ContentReviewUnavailable("wechat_text_check_missing_result")
            if payload.get("errcode") != 0:
                raise ContentReviewUnavailable(f"wechat_text_check_error_{payload.get('errcode')}")
            result = payload.get("result") or {}
            if not isinstance(result, dict):
                raise ContentReviewUnavailable("wechat_text_check_missing_result")
            suggestion = result.get("suggest")
            if suggestion in {"risky", "review"}:
                raise ContentReviewRejected(suggestion, result.get("label"))
            if suggestion != "pass":
                raise ContentReviewUnavailable("wechat_text_check_missing_result")
