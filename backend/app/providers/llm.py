import json
import re
from typing import Protocol

import httpx

from voonie.backend.app.core.config import Settings
from voonie.backend.app.providers._http import request_with_retry


class LLMProvider(Protocol):
    async def complete_json(self, system: str, user: str) -> dict: ...


class MockLLMProvider:
    async def complete_json(self, system: str, user: str) -> dict:
        if "pet_action" in system and "referenced_memories" in system:
            return {
                "reply": "我认真听着呢。先把今天的心情交给我保管一会儿吧。",
                "pet_action": "comfort",
                "referenced_memories": [],
            }
        if "结构化分析器" in system or "DiaryAnalysis" in user:
            if "FORCE_INVALID_ANALYSIS" in user:
                return {"not": "a diary analysis"}
            return {
                "summary": "一次普通但值得记下的日常。",
                "events": [
                    {
                        "summary": "用户记录了一段当天经历。",
                        "people": [],
                        "places": [],
                        "time_hint": None,
                    }
                ],
                "people": [],
                "places": [],
                "emotion": {
                    "label": "平静",
                    "intensity": 6,
                    "description": "语气放松，没有强烈情绪波动。",
                },
                "safety": {"category": "none", "notes": None},
                "sensitive_fields": [],
            }
        if "每日绘本" in system or "DailyStorybook" in user:
            page_count = 4
            if "PAGE_COUNT=6" in user:
                page_count = 6
            if "PAGE_COUNT=8" in user:
                page_count = 8
            return {
                "title": "今日绘本",
                "summary": "把当天确认过的记录收成一本小绘本。",
                "emotion_arc": ["平静", "回味"],
                "pages": [
                    {
                        "page_no": index,
                        "beat": "opening" if index == 1 else "closing" if index == page_count else "development",
                        "scene_desc": f"A diary storybook page {index}",
                        "character_action": f"The diarist continues the day in beat {index}",
                        "narration": f"第{index}页",
                        "speech_bubble": {"text": "今天也值得被记住", "bubble_type": "speech"},
                        "sfx": None,
                        "forbidden": ["readable chinese text in the image"],
                    }
                    for index in range(1, page_count + 1)
                ],
            }
        count_match = re.search(r"ILLUSTRATION_COUNT=(\d+)", user)
        illustration_count = int(count_match.group(1)) if count_match else 1
        transcript_match = re.search(
            r"【用户完整语音转录】\s*(.*?)\s*【主人公漫画设定】",
            user,
            re.S,
        )
        transcript = transcript_match.group(1).strip() if transcript_match else "今天也有值得记住的时刻。"
        sentences = [item.strip() for item in re.split(r"(?<=[。！？!?])", transcript) if item.strip()]
        if not sentences:
            sentences = [transcript]
        anchors = [sentences[min(index * len(sentences) // illustration_count, len(sentences) - 1)] for index in range(illustration_count)]
        return {
            "title": "今天，慢慢亮起来",
            "organized_diary": transcript,
            "emotion": {
                "primary_emotion": "healing",
                "emotion_label_zh": "治愈",
                "mood_score": 8,
                "analysis": "记录里有值得珍惜的轻松时刻。",
            },
            "emotion_curve": [
                {"label": "平静", "intensity": 5, "evidence": sentences[0][:40]},
                {"label": "治愈", "intensity": 8, "evidence": sentences[-1][:40]},
            ],
            "key_quote": sentences[-1],
            "panels": [
                {
                    "panel_id": panel_id,
                    "shot_type": "wide_angle" if panel_id == 1 else "medium_shot",
                    "scene_desc": f"A warm everyday scene, story beat {panel_id}",
                    "character_action": f"The main character reacts naturally in beat {panel_id}",
                    "narration": anchors[panel_id - 1],
                    "speech_bubble": None,
                    "sfx": None,
                    "source_excerpt": anchors[panel_id - 1],
                    "anchor_text": anchors[panel_id - 1],
                    "emotion_label": "治愈" if panel_id == illustration_count else "平静",
                    "visual_reason": "这是情绪变化中清晰、值得回看的真实瞬间。",
                    "forbidden": ["readable chinese text in the image"],
                }
                for panel_id in range(1, illustration_count + 1)
            ],
            "companion_note": "你认真生活的样子，已经让今天变得很特别。",
        }


class OpenAILLMProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    async def complete_json(self, system: str, user: str) -> dict:
        async def execute(client: httpx.AsyncClient) -> dict:
            response = await request_with_retry(
                client,
                "POST",
                f"{self.settings.OPENAI_BASE_URL.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.OPENAI_API_KEY}"},
                json={
                    "model": self.settings.DEFAULT_LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                },
            )
            return json.loads(response.json()["choices"][0]["message"]["content"])

        if self.client is not None:
            return await execute(self.client)
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await execute(client)


class DeepSeekLLMProvider:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client
        self.mock_fallback = MockLLMProvider()

    async def complete_json(self, system: str, user: str) -> dict:
        async def execute(client: httpx.AsyncClient) -> dict:
            try:
                response = await request_with_retry(
                    client,
                    "POST",
                    f"{self.settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {self.settings.DEEPSEEK_API_KEY}"},
                    json={
                        "model": self.settings.DEEPSEEK_MODEL,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.7,
                    },
                )
                return json.loads(response.json()["choices"][0]["message"]["content"])
            except Exception:
                if not self.settings.PRODUCTION:
                    return await self.mock_fallback.complete_json(system, user)
                raise

        if self.client is not None:
            return await execute(self.client)
        async with httpx.AsyncClient(timeout=60.0) as client:
            return await execute(client)


def get_llm_provider(settings: Settings, client: httpx.AsyncClient | None = None) -> LLMProvider:
    if settings.DEEPSEEK_API_KEY:
        return DeepSeekLLMProvider(settings, client)
    if settings.OPENAI_API_KEY:
        return OpenAILLMProvider(settings, client)
    return MockLLMProvider()


def get_pet_llm_provider(settings: Settings, client: httpx.AsyncClient | None = None) -> LLMProvider:
    if settings.DEEPSEEK_API_KEY:
        return DeepSeekLLMProvider(settings, client)
    return get_llm_provider(settings, client)
