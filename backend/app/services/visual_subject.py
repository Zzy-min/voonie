"""Resolve an explicitly imagined first-person animal before drawing a diary."""

import re

from voonie.backend.app.models.schemas import CharacterConfig


_ANIMALS = {
    "小鱼": "small fish", "鱼": "fish", "小猫": "small cat", "猫": "cat",
    "小狗": "small dog", "狗": "dog", "小鸟": "small bird", "鸟": "bird",
    "蝴蝶": "butterfly", "兔子": "rabbit", "海豚": "dolphin",
}
_SELF_AS_ANIMAL = re.compile(
    r"(?:我|自己)(?:是|变成了?|变为|化作|化身为|想象自己是)"
    r"(?:一只|一条|一头|一匹|一个)?"
    r"(" + "|".join(sorted(_ANIMALS, key=len, reverse=True)) + r")"
)


def resolve_visual_character(text: str, character: CharacterConfig) -> CharacterConfig:
    match = _SELF_AS_ANIMAL.search(text)
    if not match:
        return character
    animal = match.group(1)
    return character.model_copy(update={
        "character_name": animal,
        "appearance_prompt": f"one { _ANIMALS[animal] }, shown with natural animal anatomy",
        "visual_identity": "animal",
    })
