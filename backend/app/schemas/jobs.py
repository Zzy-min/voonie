from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from voonie.backend.app.models.schemas import CharacterConfig


class ComicJobRequest(BaseModel):
    text: str = Field(min_length=5, max_length=20000)
    character: CharacterConfig = Field(default_factory=CharacterConfig)
    custom_style: str | None = Field(default=None, max_length=2000)
    ref_image_b64: str | None = Field(default=None)


class EntryComicJobRequest(BaseModel):
    character: CharacterConfig = Field(default_factory=CharacterConfig)
    custom_style: str | None = Field(default=None, max_length=2000)
    ref_image_b64: str | None = Field(default=None)


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
