from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from voonie.backend.app.models.schemas import CharacterConfig


class ComicJobRequest(BaseModel):
    text: str = Field(min_length=5, max_length=20000)
    character: CharacterConfig = Field(default_factory=CharacterConfig)
    custom_style: str | None = Field(default=None, max_length=2000)
    ref_image_b64: str | None = Field(default=None)


class EntryComicJobRequest(BaseModel):
    character_id: str | None = Field(default=None, max_length=36)
    character: CharacterConfig = Field(default_factory=CharacterConfig)
    custom_style: str | None = Field(default=None, max_length=2000)
    ref_image_b64: str | None = Field(default=None)
    reference_id: str | None = Field(default=None, max_length=36)
    reference_ids: list[str] = Field(default_factory=list, max_length=3)
    style_preset_override: Literal["chibi_manga", "warm_watercolor", "anime_cel", "retro_comic"] | None = None
    aspect_ratio: Literal["1:1", "4:3", "3:4"] = "4:3"

    @model_validator(mode="after")
    def validate_references(self):
        ids = self.reference_ids or ([self.reference_id] if self.reference_id else [])
        if any(not value or len(value) > 36 for value in ids) or len(set(ids)) != len(ids):
            raise ValueError("Reference IDs must be unique and nonempty")
        if self.reference_ids and self.reference_id and self.reference_id != self.reference_ids[0]:
            raise ValueError("Legacy reference_id must match the first reference_ids item")
        return self


class JobQueuedResponse(BaseModel):
    job_id: str
    status: Literal["queued"] = "queued"


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    stage: str
    progress: float
    error: str | None
    result: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None
