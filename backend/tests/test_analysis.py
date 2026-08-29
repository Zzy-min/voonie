import asyncio

import pytest
from pydantic import ValidationError

from voonie.backend.app.core.config import Settings
from voonie.backend.app.schemas.analysis import DiaryAnalysis
from voonie.backend.app.services.diary_analyzer import DiaryAnalyzer
from voonie.backend.app.providers.llm import MockLLMProvider


class CountingInvalidProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def complete_json(self, system: str, user: str) -> dict:
        self.calls += 1
        return {"not": "valid"}


def run(coro):
    return asyncio.run(coro)


def test_mock_analysis_covers_short_and_mixed_language():
    analyzer = DiaryAnalyzer(provider=MockLLMProvider(), app_settings=Settings(OPENAI_API_KEY=""))
    for text in ["嗯。", "today 有点累 but okay", "没有发生什么特别的事"]:
        result = run(analyzer.analyze(text))
        assert isinstance(result, DiaryAnalysis)
        assert result.emotion.label
        assert "safety" in result.model_dump()
        public = result.public_emotion()
        assert "category" not in public
        stored = result.stored_events()
        assert stored["safety"]["category"] == "none"


def test_invalid_json_is_retried_once_then_raises():
    provider = CountingInvalidProvider()
    analyzer = DiaryAnalyzer(provider=provider, app_settings=Settings(OPENAI_API_KEY="live-test-key"))
    with pytest.raises(ValidationError):
        run(analyzer.analyze("FORCE_INVALID_ANALYSIS 今天没什么事"))
    assert provider.calls == 2
