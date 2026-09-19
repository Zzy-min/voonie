from typing import Any, Literal

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    category: Literal["feature", "bug", "experience", "ai", "image", "voice", "account", "other"]
    description: str = Field(min_length=5, max_length=4000)
    contact: str | None = Field(default=None, max_length=255)
    device: dict[str, Any] = Field(default_factory=dict)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    screenshot_base64: str | None = Field(default=None, max_length=8_000_000)
    include_related_content: bool = False


class FeedbackResponse(BaseModel):
    id: str
    status: str
