from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

from voonie.backend.app.models.schemas import SpeechBubble


class DailyDiaryResponse(BaseModel):
    id: str
    diary_date: str
    timezone: str
    status: str
    title: str | None
    summary: str | None
    emotion_arc: list[str]
    entry_ids: list[str]
    generation_version: int
    latest_artifact_id: str | None = None


class DailyDiaryUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    summary: str | None = Field(default=None, min_length=1, max_length=4000)


class DailyPage(BaseModel):
    page_no: int
    beat: Literal["opening", "development", "closing"]
    scene_desc: str
    character_action: str
    narration: str | None = None
    speech_bubble: SpeechBubble | None = None
    sfx: str | None = None
    forbidden: list[str] = Field(default_factory=lambda: ["readable chinese text in the image"])


class DailyStorybook(BaseModel):
    title: str
    summary: str
    emotion_arc: list[str]
    pages: list[DailyPage]


class DailyJobQueued(BaseModel):
    job_id: str
    status: Literal["queued"] = "queued"
