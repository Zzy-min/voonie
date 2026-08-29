from typing import Literal

from pydantic import BaseModel, Field


class DiaryEvent(BaseModel):
    summary: str = Field(min_length=1, max_length=500)
    people: list[str] = Field(default_factory=list)
    places: list[str] = Field(default_factory=list)
    time_hint: str | None = None


class VisibleEmotion(BaseModel):
    label: str = Field(min_length=1, max_length=64)
    intensity: int = Field(ge=1, le=10)
    description: str = Field(min_length=1, max_length=500)


class SafetyClassification(BaseModel):
    category: Literal["none", "self_harm", "violence", "emergency"] = "none"
    notes: str | None = None


class DiaryAnalysis(BaseModel):
    summary: str = Field(min_length=1, max_length=800)
    events: list[DiaryEvent] = Field(default_factory=list)
    people: list[str] = Field(default_factory=list)
    places: list[str] = Field(default_factory=list)
    emotion: VisibleEmotion
    safety: SafetyClassification = Field(default_factory=SafetyClassification)
    sensitive_fields: list[str] = Field(default_factory=list)

    def public_emotion(self) -> dict:
        return self.emotion.model_dump(mode="json")

    def stored_events(self, extra: dict | None = None) -> dict:
        payload = self.model_dump(mode="json")
        if extra:
            payload.update(extra)
        return payload
