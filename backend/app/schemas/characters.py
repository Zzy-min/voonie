from typing import Any, Literal

from pydantic import BaseModel, Field


class CharacterBible(BaseModel):
    age_range: str = "young adult"
    hair: str = "short brown hair"
    outfit: str = "oversized yellow hoodie"
    body: str = "small chibi proportions"
    features: str = "round glasses"
    accessories: str = "none"
    locked: list[str] = Field(default_factory=lambda: ["hairstyle", "main outfit color", "signature glasses"])


class CharacterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    appearance_prompt: str = Field(min_length=1, max_length=2000)
    style_preset: Literal["chibi_manga", "warm_watercolor", "retro_comic"] = "chibi_manga"
    bible: CharacterBible = Field(default_factory=CharacterBible)
    seed: int | None = None


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    appearance_prompt: str | None = Field(default=None, min_length=1, max_length=2000)
    style_preset: Literal["chibi_manga", "warm_watercolor", "retro_comic"] | None = None
    bible: CharacterBible | None = None
    seed: int | None = None


class CharacterReferenceResponse(BaseModel):
    id: str
    kind: str
    media_key: str
    content_hash: str
    width: int
    height: int
    moderation_status: str


class CharacterResponse(BaseModel):
    id: str
    name: str
    appearance_prompt: str
    style_preset: str
    bible: dict[str, Any]
    version: int
    seed: int | None
    references: list[CharacterReferenceResponse]
