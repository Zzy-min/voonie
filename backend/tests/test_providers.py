import asyncio
import hashlib
import uuid
from pathlib import Path

import pytest
import httpx

from voonie.backend.app.core.config import Settings
from voonie.backend.app.models.schemas import CharacterConfig, ComicPanel
from voonie.backend.app.providers.asr import (
    LocalWhisperASRProvider,
    MockASRProvider,
    OpenAIASRProvider,
    UnavailableASRProvider,
    get_asr_provider,
)
from voonie.backend.app.providers._http import request_with_retry
from voonie.backend.app.providers.embeddings import MockEmbeddingProvider, OpenAIEmbeddingProvider, get_embedding_provider
from voonie.backend.app.providers.image import (
    ArkImageProvider,
    ImagePromptRejectedError,
    MockImageProvider,
    OpenAIImageProvider,
    get_image_provider,
)
from voonie.backend.app.providers.llm import DeepSeekLLMProvider, MockLLMProvider, OpenAILLMProvider, get_llm_provider, get_pet_llm_provider
from voonie.backend.app.services.storyboard_agent import StoryboardAgent
from voonie.backend.app.services.image_gen_service import ImageGenService
from voonie.backend.app.services.storage_service import StorageService


def run(coroutine):
    return asyncio.run(coroutine)


def test_provider_factories_never_use_mock_in_live_mode_without_explicit_opt_in():
    unavailable_settings = Settings(
        OPENAI_API_KEY="",
        LOCAL_ASR_ENABLED=False,
        ALLOW_MOCK_ASR=False,
    )
    mock_settings = Settings(
        OPENAI_API_KEY="",
        LOCAL_ASR_ENABLED=False,
        ALLOW_MOCK_ASR=True,
    )
    local_settings = Settings(
        OPENAI_API_KEY="",
        LOCAL_ASR_ENABLED=True,
        ALLOW_MOCK_ASR=False,
    )
    live_settings = Settings(OPENAI_API_KEY="live-test-key")

    assert isinstance(get_llm_provider(mock_settings), MockLLMProvider)
    assert isinstance(get_asr_provider(unavailable_settings), UnavailableASRProvider)
    assert isinstance(get_asr_provider(mock_settings), MockASRProvider)
    assert isinstance(get_asr_provider(local_settings), LocalWhisperASRProvider)
    assert isinstance(get_image_provider(mock_settings), MockImageProvider)
    assert isinstance(get_embedding_provider(mock_settings), MockEmbeddingProvider)
    assert isinstance(get_llm_provider(live_settings), OpenAILLMProvider)
    assert isinstance(get_asr_provider(live_settings), OpenAIASRProvider)
    assert isinstance(get_image_provider(live_settings), OpenAIImageProvider)
    assert isinstance(get_embedding_provider(live_settings), OpenAIEmbeddingProvider)
    assert get_asr_provider(unavailable_settings).supports_real_transcription is False
    assert get_asr_provider(mock_settings).supports_real_transcription is False
    assert get_asr_provider(local_settings).supports_real_transcription is True
    assert get_asr_provider(live_settings).supports_real_transcription is True


def test_local_whisper_provider_returns_real_model_segments():
    class Segment:
        def __init__(self, text: str):
            self.text = text

    class FakeModel:
        def transcribe(self, audio, **kwargs):
            assert audio.read(4) == b"RIFF"
            assert kwargs["language"] == "zh"
            return iter([Segment("今天不是很開心﹐"), Segment("下午三點見到了小王。")]), object()

    provider = LocalWhisperASRProvider(
        Settings(LOCAL_ASR_ENABLED=True, LOCAL_ASR_MODEL="small"),
        model_loader=lambda: FakeModel(),
    )

    transcript = run(provider.transcribe(b"RIFF-real-audio", "voice.wav"))

    assert transcript == "今天不是很开心，下午三点见到了小王。"


def test_ark_image_and_deepseek_pet_factories_are_independent():
    settings = Settings(
        ARK_API_KEY="ark-test-key",
        DEEPSEEK_API_KEY="deepseek-test-key",
        OPENAI_API_KEY="",
    )

    assert isinstance(get_image_provider(settings), ArkImageProvider)
    assert isinstance(get_pet_llm_provider(settings), DeepSeekLLMProvider)
    assert isinstance(get_llm_provider(settings), DeepSeekLLMProvider)


def test_ark_image_provider_uses_seedream_api_and_decodes_base64():
    image_bytes = b"\x89PNG\r\n\x1a\nreal-image"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://ark.cn-beijing.volces.com/api/v3/images/generations"
        assert request.headers["Authorization"] == "Bearer ark-test-key"
        body = __import__("json").loads(request.content)
        assert body["model"] == "doubao-seedream-4-0-250828"
        assert body["response_format"] == "b64_json"
        return httpx.Response(
            200,
            request=request,
            json={"data": [{"b64_json": __import__("base64").b64encode(image_bytes).decode()}]},
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = ArkImageProvider(
                Settings(
                    ARK_API_KEY="ark-test-key",
                    PRODUCTION=True,
                    JWT_SECRET="ark-provider-test-secret-long-enough",
                    COOKIE_SECURE=True,
                    OPENAI_API_KEY="asr-provider-test-key",
                ),
                client,
            )
            return await provider.generate("温暖绘本", ref_image=None, seed=7)

    assert run(exercise()) == image_bytes


def test_ark_image_provider_labels_sensitive_prompt_rejection():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            request=request,
            json={
                "error": {
                    "code": "InputTextSensitiveContentDetected",
                    "message": "The input text may contain sensitive information.",
                }
            },
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = ArkImageProvider(
                Settings(
                    ARK_API_KEY="ark-test-key",
                    PRODUCTION=True,
                    JWT_SECRET="ark-provider-test-secret-long-enough",
                    COOKIE_SECURE=True,
                    OPENAI_API_KEY="asr-provider-test-key",
                ),
                client,
            )
            return await provider.generate("包含精确地点的日记插图", ref_image=None, seed=None)

    with pytest.raises(RuntimeError, match="image_prompt_rejected"):
        run(exercise())


def test_image_service_retries_rejected_prompt_without_exact_location():
    class RejectExactLocationOnce:
        def __init__(self):
            self.prompts = []

        async def generate(self, prompt, *, ref_image, seed):
            self.prompts.append(prompt)
            if len(self.prompts) == 1:
                raise ImagePromptRejectedError("image_prompt_rejected")
            return b"\x89PNG\r\n\x1a\nsafe-image"

    media_dir = Path("voonie/backend/.pytest-data") / f"image-retry-{uuid.uuid4().hex}"
    settings = Settings(TEMP_MEDIA_DIR=media_dir)
    provider = RejectExactLocationOnce()
    service = ImageGenService(
        provider=provider,
        app_settings=settings,
        storage=StorageService(settings),
    )
    panel = ComicPanel(
        panel_id=1,
        scene_desc="夜晚从天安门骑车前往国家会议中心",
        character_action="女孩骑着自行车，完成长距离骑行后很满足",
        source_excerpt="从天安门到国家会议中心骑了12.2公里",
        anchor_text="从天安门到国家会议中心",
        emotion_label="满足",
    )

    path, used_prompt = run(
        service.generate_panel_image(panel, CharacterConfig(style_preset="chibi_manga"))
    )

    try:
        assert path.read_bytes().startswith(b"\x89PNG")
        assert len(provider.prompts) == 2
        assert "天安门" in provider.prompts[0]
        assert "天安门" not in provider.prompts[1]
        assert "abstract emotional memory illustration" in provider.prompts[1]
        assert used_prompt == provider.prompts[1]
    finally:
        path.unlink(missing_ok=True)
        media_dir.rmdir()


def test_mock_providers_are_deterministic():
    llm = MockLLMProvider()
    asr = MockASRProvider()
    image = MockImageProvider()
    embeddings = MockEmbeddingProvider()

    assert run(llm.complete_json("storyboard", "same input")) == run(
        llm.complete_json("storyboard", "same input")
    )
    assert run(asr.transcribe(b"same audio", "voice.m4a")) == run(
        asr.transcribe(b"same audio", "voice.m4a")
    )
    first_image = run(image.generate("same prompt", ref_image=None, seed=7))
    second_image = run(image.generate("same prompt", ref_image=None, seed=7))
    assert hashlib.sha256(first_image).digest() == hashlib.sha256(second_image).digest()
    assert first_image.startswith(b"\x89PNG\r\n\x1a\n")
    assert run(embeddings.embed("same text")) == run(embeddings.embed("same text"))


class FailingLLMProvider:
    async def complete_json(self, system: str, user: str) -> dict:
        raise RuntimeError("provider unavailable")


def test_live_provider_failure_is_not_silently_replaced_with_mock():
    agent = StoryboardAgent(
        provider=FailingLLMProvider(),
        app_settings=Settings(OPENAI_API_KEY="live-test-key"),
    )

    with pytest.raises(RuntimeError, match="provider unavailable"):
        run(agent.generate_storyboard("今天很开心", CharacterConfig()))


def test_storyboard_uses_content_length_for_sparse_memory_illustrations():
    agent = StoryboardAgent(provider=MockLLMProvider(), app_settings=Settings())
    short_text = "今天看到一朵很好看的云。"
    rich_text = "今天发生了很多事情。" * 100

    short = run(agent.generate_storyboard(short_text, CharacterConfig()))
    rich = run(agent.generate_storyboard(rich_text, CharacterConfig()))

    assert short.organized_diary == short_text
    assert len(short.panels) == 1
    assert len(rich.panels) == 5
    assert all(panel.anchor_text in rich.organized_diary for panel in rich.panels)
    assert rich.emotion_curve


def test_http_retry_only_retries_429_and_server_errors():
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(429 if attempts == 1 else 200, request=request)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await request_with_retry(client, "GET", "https://provider.test")

    assert run(exercise()).status_code == 200
    assert attempts == 2


def test_http_retry_does_not_retry_non_retryable_client_errors():
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(400, request=request)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await request_with_retry(client, "GET", "https://provider.test")

    with pytest.raises(httpx.HTTPStatusError):
        run(exercise())
    assert attempts == 1


def test_http_retry_recovers_from_connection_reset_and_stays_bounded():
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise httpx.ConnectError("connection reset", request=request)
        return httpx.Response(200, request=request)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await request_with_retry(client, "GET", "https://provider.test", attempts=3)

    assert run(exercise()).status_code == 200
    assert attempts == 3
