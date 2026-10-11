from voonie.backend.app.models.schemas import CharacterConfig, ComicPanel
from voonie.backend.app.services.prompt_builder import build_panel_prompt
from voonie.backend.app.services.visual_subject import resolve_visual_character


def test_first_person_fish_uses_animal_instead_of_saved_human():
    saved_human = CharacterConfig(appearance_prompt="a young man in a green shirt")
    character = resolve_visual_character(
        "我是一只小鱼在水池底部游泳。", saved_human,
    )
    panel = ComicPanel(
        panel_id=1,
        scene_desc="水池底部",
        character_action="游泳",
        source_excerpt="我是一只小鱼在水池底部游泳。",
    )

    assert character.visual_identity == "animal"
    prompt = build_panel_prompt(panel, character, "warm watercolor illustration")
    assert "small fish" in prompt
    assert "not a person" in prompt
    assert "young man" not in prompt
    assert "human person with normal human anatomy" not in prompt


def test_ordinary_human_diary_keeps_human_character():
    character = CharacterConfig(appearance_prompt="a young man in a green shirt")
    assert resolve_visual_character("我像小鱼一样游泳。", character) == character
