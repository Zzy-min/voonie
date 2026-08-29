import json
import re

from voonie.backend.app.core.config import Settings, settings
from voonie.backend.app.models.schemas import CharacterConfig, Storyboard
from voonie.backend.app.providers.llm import LLMProvider, get_llm_provider


class StoryboardAgent:
    SYSTEM_PROMPT = """你是一个克制、准确的语音日记整理者与记忆插图策划者。
你的任务：
1. 把用户完整口述轻度整理为自然的第一人称日记：去掉明显重复和无意义语气词，补标点、分段、理顺时间，但不得摘要、过度文学化或删除真实细节。
2. AI 的引导语不得进入日记正文；不得添加用户没说过的人、地点、天气、事件或情绪。
3. 按讲述顺序分析事件与情绪曲线，证据必须来自用户原话。
4. 只挑选指定数量、视觉与情绪价值最高的真实瞬间作为记忆插图。每张图必须提供 source_excerpt 和 organized_diary 中可直接定位的 anchor_text。
5. 插图不是绘本故事，不要补剧情，不要机械覆盖每件事；信息不足时使用抽象情绪画面。
6. 同一篇日记的人物、画风、配色和时间氛围必须连续；画面内不要生成文字或气泡。
7. 输出一句 20-40 字、不过度分析的小宠物暖心便签。
必须只输出符合请求结构的 JSON。"""

    @staticmethod
    def illustration_count(transcript: str) -> int:
        length = len(transcript.strip())
        if length < 80:
            return 1
        if length < 240:
            return 2
        if length < 500:
            return 3
        if length < 900:
            return 4
        return 5

    @staticmethod
    def _sentences(text: str) -> list[str]:
        sentences = [item.strip() for item in re.split(r"(?<=[。！？!?])", text) if item.strip()]
        return sentences or [text.strip()]

    def _enforce_source_fidelity(
        self,
        storyboard: Storyboard,
        transcript: str,
        expected_count: int,
    ) -> Storyboard:
        if len(storyboard.panels) != expected_count:
            raise ValueError(f"expected {expected_count} memory illustrations, got {len(storyboard.panels)}")

        # A fluent provider rewrite can keep the broad topic while silently
        # adding concrete actions, objects, or feelings. Length/excerpt checks
        # cannot prove those additions came from the user, so only the source
        # transcript is safe to persist as the diary body.
        storyboard.organized_diary = transcript.strip()

        source_sentences = self._sentences(transcript)
        diary_sentences = self._sentences(storyboard.organized_diary)
        for index, panel in enumerate(storyboard.panels):
            fallback_source = source_sentences[
                min(index * len(source_sentences) // expected_count, len(source_sentences) - 1)
            ]
            if not panel.source_excerpt or panel.source_excerpt not in transcript:
                panel.source_excerpt = fallback_source
            if not panel.anchor_text or panel.anchor_text not in storyboard.organized_diary:
                panel.anchor_text = (
                    panel.source_excerpt
                    if panel.source_excerpt in storyboard.organized_diary
                    else diary_sentences[
                        min(index * len(diary_sentences) // expected_count, len(diary_sentences) - 1)
                    ]
                )

        for index, point in enumerate(storyboard.emotion_curve):
            if not point.evidence or point.evidence not in transcript:
                point.evidence = source_sentences[min(index, len(source_sentences) - 1)]
        if storyboard.key_quote and storyboard.key_quote not in transcript:
            storyboard.key_quote = None
        return storyboard

    def __init__(
        self,
        provider: LLMProvider | None = None,
        app_settings: Settings = settings,
    ) -> None:
        self.provider = provider or get_llm_provider(app_settings)
        self.settings = app_settings

    async def generate_storyboard(
        self,
        transcript: str,
        character: CharacterConfig,
        custom_style: str | None = None,
    ) -> Storyboard:
        style_prompt = custom_style or self.settings.STYLE_PRESETS.get(
            character.style_preset,
            self.settings.STYLE_PRESETS["chibi_manga"],
        )
        illustration_count = self.illustration_count(transcript)
        response_schema = json.dumps(Storyboard.model_json_schema(), ensure_ascii=False)
        user_prompt = f"""
【用户完整语音转录】
{transcript}

【主人公漫画设定】
- 角色名称: {character.character_name}
- 外貌设定: {character.appearance_prompt}
- 风格基调: {style_prompt}

ILLUSTRATION_COUNT={illustration_count}
严格遵循以下 JSON Schema；panels 必须正好包含 {illustration_count} 项。organized_diary 必须保留完整语义和全部有效事件，不能写成摘要；anchor_text 必须原样出现在 organized_diary 中：
{response_schema}
"""
        parsed = await self.provider.complete_json(self.SYSTEM_PROMPT, user_prompt)
        storyboard = Storyboard.model_validate(parsed)
        return self._enforce_source_fidelity(storyboard, transcript, illustration_count)


storyboard_agent = StoryboardAgent()
