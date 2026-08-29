from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PanelResponse(BaseModel):
    panel_no: int
    status: str
    image_url: str | None
    storyboard: dict[str, Any]
    retry_count: int


class ArtifactResponse(BaseModel):
    id: str
    job_id: str
    entry_id: str | None
    artifact_type: str
    version: int
    title: str
    emotion_label: str
    mood_score: int
    companion_note: str
    composite_url: str | None
    character_snapshot: dict[str, Any]
    panels: list[PanelResponse]
    created_at: datetime
