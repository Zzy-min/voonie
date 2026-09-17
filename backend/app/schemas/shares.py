from datetime import datetime

from pydantic import BaseModel, Field


class ShareUpsert(BaseModel):
    artifact_id: str
    caption: str = Field(min_length=1, max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=10)
    show_location: bool = False
    hide_date: bool = False
    is_public: bool = False


class SharePostResponse(BaseModel):
    id: str
    artifact_id: str
    author: str
    caption: str
    tags: list[str]
    mood: str
    image_url: str | None
    is_public: bool
    hide_date: bool
    created_at: datetime
    likes: int
    collects: int
    is_liked: bool
    is_collected: bool
    is_owner: bool


class ReactionResponse(BaseModel):
    active: bool
    count: int


class ShareVisibilityUpdate(BaseModel):
    is_public: bool


class ShareReportCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=64)
    detail: str | None = Field(default=None, max_length=500)


class ShareReportResponse(BaseModel):
    submitted: bool
