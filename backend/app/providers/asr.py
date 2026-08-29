import asyncio
import hashlib
import importlib.util
import io
import threading
from collections.abc import Callable
from typing import Any, Protocol

import httpx

from voonie.backend.app.core.config import Settings
from voonie.backend.app.providers._http import request_with_retry


class ASRProvider(Protocol):
    @property
    def supports_real_transcription(self) -> bool: ...

    async def transcribe(self, audio: bytes, filename: str) -> str: ...


class MockASRProvider:
    supports_real_transcription = False

    async def transcribe(self, audio: bytes, filename: str) -> str:
        return "今天下班后去附近的小公园散步，看到夕阳很温柔，心情变得特别轻松治愈。"


class UnavailableASRProvider:
    supports_real_transcription = False

    async def transcribe(self, audio: bytes, filename: str) -> str:
        raise RuntimeError("No real ASR provider is configured")


class LocalWhisperASRProvider:
    supports_real_transcription = True

    def __init__(
        self,
        settings: Settings,
        model_loader: Callable[[], Any] | None = None,
        text_simplifier: Callable[[str], str] | None = None,
    ) -> None:
        self.settings = settings
        self._model_loader = model_loader or self._load_model
        self._model: Any | None = None
        self._text_simplifier = text_simplifier or self._load_text_simplifier()
        self._model_lock = threading.Lock()
        self._transcribe_lock = threading.Lock()

    @staticmethod
    def _load_text_simplifier() -> Callable[[str], str]:
        from opencc import OpenCC

        return OpenCC("t2s").convert

    def _load_model(self):
        from faster_whisper import WhisperModel

        return WhisperModel(
            self.settings.LOCAL_ASR_MODEL,
            device=self.settings.LOCAL_ASR_DEVICE,
            compute_type=self.settings.LOCAL_ASR_COMPUTE_TYPE,
        )

    def _get_model(self):
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    self._model = self._model_loader()
        return self._model

    def _transcribe_sync(self, audio: bytes) -> str:
        with self._transcribe_lock:
            segments, _ = self._get_model().transcribe(
                io.BytesIO(audio),
                language=self.settings.LOCAL_ASR_LANGUAGE,
                beam_size=self.settings.LOCAL_ASR_BEAM_SIZE,
                vad_filter=True,
                condition_on_previous_text=True,
                initial_prompt=self.settings.LOCAL_ASR_INITIAL_PROMPT,
            )
            transcript = "".join(segment.text.strip() for segment in segments).strip()
        if not transcript:
            raise ValueError("ASR provider returned an empty transcript")
        simplified = self._text_simplifier(transcript)
        return simplified.translate(str.maketrans({",": "，", "﹐": "，", "﹒": "。"}))

    async def transcribe(self, audio: bytes, filename: str) -> str:
        return await asyncio.to_thread(self._transcribe_sync, audio)


class OpenAIASRProvider:
    supports_real_transcription = True

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    async def transcribe(self, audio: bytes, filename: str) -> str:
        async def execute(client: httpx.AsyncClient) -> str:
            response = await request_with_retry(
                client,
                "POST",
                f"{self.settings.OPENAI_BASE_URL.rstrip('/')}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                files={"file": (filename, audio, "application/octet-stream")},
                data={"model": self.settings.DEFAULT_ASR_MODEL},
            )
            transcript = response.json().get("text", "").strip()
            if not transcript:
                raise ValueError("ASR provider returned an empty transcript")
            return transcript

        if self.client is not None:
            return await execute(self.client)
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await execute(client)


def get_asr_provider(settings: Settings, client: httpx.AsyncClient | None = None) -> ASRProvider:
    if settings.OPENAI_API_KEY:
        return OpenAIASRProvider(settings, client)
    if settings.LOCAL_ASR_ENABLED:
        if (
            importlib.util.find_spec("faster_whisper") is not None
            and importlib.util.find_spec("opencc") is not None
        ):
            return LocalWhisperASRProvider(settings)
        return UnavailableASRProvider()
    if settings.ALLOW_MOCK_ASR or settings.TESTING:
        return MockASRProvider()
    return UnavailableASRProvider()
