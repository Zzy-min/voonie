from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator


def validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Unknown IANA timezone") from exc
    return value


def validate_aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("entry_date must include a UTC offset")
    return value


class TextEntryCreate(BaseModel):
    local_id: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=20000)
    entry_date: datetime
    timezone: str = "UTC"

    _timezone = field_validator("timezone")(validate_timezone)
    _entry_date = field_validator("entry_date")(validate_aware_datetime)

    @field_validator("text")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("text cannot be empty or whitespace only")
        return value


class EntryUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=20000)
    entry_date: datetime | None = None
    timezone: str | None = None
    status: Literal["draft", "confirmed"] | None = None

    _timezone = field_validator("timezone")(lambda value: validate_timezone(value) if value else value)
    _entry_date = field_validator("entry_date")(lambda value: validate_aware_datetime(value) if value else value)

    @field_validator("text")
    @classmethod
    def validate_update_text(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("text cannot be empty or whitespace only")
        return value

    @field_validator("text", "entry_date", "timezone", "status")
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError("Explicit null is not allowed")
        return value


class EntryResponse(BaseModel):
    id: str
    local_id: str
    entry_date: datetime
    timezone: str
    input_type: Literal["text", "voice"]
    redacted_text: str
    emotion: dict[str, Any]
    events: dict[str, Any]
    status: Literal["draft", "confirmed", "processing", "analysis_failed"]
    created_at: datetime
    updated_at: datetime


class EntryListResponse(BaseModel):
    items: list[EntryResponse]
    next_cursor: str | None = None
