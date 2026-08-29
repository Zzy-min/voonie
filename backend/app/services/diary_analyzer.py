from __future__ import annotations

import json

from pydantic import ValidationError

from voonie.backend.app.core.config import Settings, settings
from voonie.backend.app.providers.llm import LLMProvider, get_llm_provider
from voonie.backend.app.schemas.analysis import DiaryAnalysis, SafetyClassification, VisibleEmotion


class DiaryAnalyzer:
    SYSTEM_PROMPT = """你是私密成人语音日记的结构化分析器。
只输出符合 Schema 的 JSON。
字段要求：
- summary: 一句话摘要
- events: 事件列表，每项含 summary、people、places、time_hint
- people / places: 去重后的人物和地点
- emotion: 用户可见情绪，含 label、intensity(1-10)、description
- safety: 内部安全分类，category 只能是 none/self_harm/violence/emergency
- sensitive_fields: 需要脱敏的字段名
不要输出诊断或治疗建议。短文本、口语、中英混合和无明确事件都必须给出合法结果。"""

    def __init__(
        self,
        provider: LLMProvider | None = None,
        app_settings: Settings = settings,
    ) -> None:
        self.provider = provider or get_llm_provider(app_settings)

    async def analyze(self, text: str) -> DiaryAnalysis:
        schema = json.dumps(DiaryAnalysis.model_json_schema(), ensure_ascii=False)
        user_prompt = f"""【日记文本】
{text}

严格遵循 JSON Schema：
{schema}
"""
        last_error: Exception | None = None
        for _ in range(2):
            try:
                parsed = await self.provider.complete_json(self.SYSTEM_PROMPT, user_prompt)
                return DiaryAnalysis.model_validate(parsed)
            except (ValidationError, TypeError, ValueError, json.JSONDecodeError) as exc:
                last_error = exc
        raise last_error or ValueError("Diary analysis failed")

    @staticmethod
    def fallback(text: str) -> DiaryAnalysis:
        snippet = text.strip() or "没有明确事件的一天。"
        return DiaryAnalysis(
            summary=snippet[:80],
            events=[],
            people=[],
            places=[],
            emotion=VisibleEmotion(label="平静", intensity=5, description="记录较短，情绪不够明确。"),
            safety=SafetyClassification(),
            sensitive_fields=[],
        )
