import asyncio

from voonie.backend.app.models.schemas import CharacterConfig
from voonie.backend.app.services.storyboard_agent import StoryboardAgent


class InventingProvider:
    async def complete_json(self, _system: str, _prompt: str) -> dict:
        return {
            "title": "被改写的一天",
            "organized_diary": (
                "今天上午开会时有点紧张。我忍不住一直搓手，"
                "中午热乎乎的面条让我慢慢放松，傍晚的天空像被染过一样。"
            ),
            "emotion": {
                "primary_emotion": "healing",
                "emotion_label_zh": "治愈",
                "mood_score": 8,
                "analysis": "情绪逐渐转好。",
            },
            "emotion_curve": [
                {"label": "紧张", "intensity": 6, "evidence": "今天上午开会时有点紧张。"},
            ],
            "key_quote": "傍晚看见橙色晚霞，觉得很温暖。",
            "panels": [
                {
                    "panel_id": 1,
                    "shot_type": "wide_angle",
                    "scene_desc": "傍晚骑车看见晚霞",
                    "character_action": "骑车回家",
                    "narration": "傍晚看见橙色晚霞，觉得很温暖。",
                    "speech_bubble": None,
                    "sfx": None,
                    "source_excerpt": "傍晚看见橙色晚霞，觉得很温暖。",
                    "anchor_text": "傍晚看见橙色晚霞，觉得很温暖。",
                    "emotion_label": "治愈",
                    "visual_reason": "真实的情绪转折。",
                    "forbidden": ["readable chinese text in the image"],
                }
            ],
            "companion_note": "今天也值得被好好记住。",
        }


def test_storyboard_never_persists_unverifiable_diary_rewrites():
    transcript = "今天上午开会时有点紧张。傍晚看见橙色晚霞，觉得很温暖。"

    storyboard = asyncio.run(
        StoryboardAgent(provider=InventingProvider()).generate_storyboard(
            transcript,
            CharacterConfig(),
        )
    )

    assert storyboard.organized_diary == transcript
    assert "搓手" not in storyboard.organized_diary
    assert "面条" not in storyboard.organized_diary
