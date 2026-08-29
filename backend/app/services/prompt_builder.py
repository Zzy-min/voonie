from __future__ import annotations

from typing import Any

from voonie.backend.app.models.schemas import CharacterConfig, ComicPanel


DEFAULT_BIBLE = {
    "age_range": "young adult",
    "hair": "short brown hair",
    "outfit": "oversized yellow hoodie",
    "body": "small chibi proportions",
    "features": "round glasses",
    "accessories": "none",
    "companion_dog": (
        "a cute cheerful fluffy orange-and-white puppy named Voonie "
        "(corgi-shiba hybrid, soft fluffy ears, round sparkling eyes, joyful smile, wagging tail)"
    ),
    "locked": ["hairstyle", "main outfit color", "signature glasses", "puppy appearance"],
}


def character_snapshot(character: CharacterConfig, bible: dict[str, Any] | None = None) -> dict[str, Any]:
    card = {**DEFAULT_BIBLE, **(bible or {})}
    return {
        "character_name": character.character_name,
        "appearance_prompt": character.appearance_prompt,
        "style_preset": character.style_preset,
        "bible": card,
    }


def build_panel_prompt(
    panel: ComicPanel,
    character: CharacterConfig,
    style_prompt: str,
    bible: dict[str, Any] | None = None,
    use_ref: bool = False,
    abstract: bool = False,
) -> str:
    card = character_snapshot(character, bible)["bible"]
    locked = ", ".join(card.get("locked") or [])
    forbidden = ", ".join(
        ["readable chinese text in the image"] if abstract
        else (panel.forbidden or ["readable chinese text in the image"])
    )

    ref_header = (
        "【STRICT VISUAL REFERENCE】Strictly maintain the character and scene appearance from the reference image. "
        "Keep facial features, hair, clothing colors, and pet appearance identical to the reference. "
    ) if use_ref else ""

    context_str = f"{panel.scene_desc} {panel.character_action}".lower()
    dog_clause = (
        f"Companion Pet: {card.get('companion_dog')}. "
        if ("dog" in context_str or "voonie" in context_str or "小狗" in panel.scene_desc or "小狗" in panel.character_action)
        else ""
    )

    memory_clause = (
        "Create an abstract emotional memory illustration in a generic everyday setting. "
        f"Express the feeling of {panel.emotion_label or 'a calm reflective mood'} through pose, lighting, and color. "
        "Do not show named landmarks, public institutions, signs, maps, or readable place names. "
    ) if abstract else (
        f"Source-grounded memory: {panel.source_excerpt or panel.anchor_text}. "
        f"Scene change only: {panel.scene_desc}. Action: {panel.character_action}. Shot: {panel.shot_type}. "
    )

    return (
        f"{ref_header}Comic panel illustration. {style_prompt}. "
        f"Stable character: {character.appearance_prompt}. {dog_clause}"
        f"Age range: {card.get('age_range')}; hair: {card.get('hair')}; outfit: {card.get('outfit')}; "
        f"body: {card.get('body')}; features: {card.get('features')}; accessories: {card.get('accessories')}. "
        f"Keep locked traits unchanged: {locked}. "
        f"{memory_clause}"
        "Critical source facts must be visibly present and take priority over decorative choices, "
        "especially the stated time of day, weather, location, objects, and lighting. "
        f"Masterpiece, beautiful clean line art, luminous ambient lighting, rich color harmony. "
        f"Negative constraints: {forbidden}. No speech balloons, no captions, no readable text. Negative: distorted anatomy, deformed fingers, extra limbs, watermark, blurry, low resolution."
    )
