from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    device_secret_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    memory_opt_in: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", nullable=False)
    nickname: Mapped[str] = mapped_column(String(32), default="小主人", nullable=False)
    quote: Mapped[str] = mapped_column(String(120), default="生活或许忙碌，但记得停下来，听一听自己的声音。", nullable=False)
    quote_note: Mapped[str] = mapped_column(String(80), default="今天也值得被好好收藏。", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    jobs: Mapped[list[Job]] = relationship(back_populates="user", cascade="all, delete-orphan")


class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    hashed_token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Character(TimestampMixin, Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    appearance_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    style_preset: Mapped[str] = mapped_column(String(64), nullable=False)
    bible_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    reference_image_key: Mapped[str | None] = mapped_column(String(512))
    seed: Mapped[int | None] = mapped_column(Integer)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    references: Mapped[list["CharacterReference"]] = relationship(
        back_populates="character", cascade="all, delete-orphan"
    )


class CharacterReference(TimestampMixin, Base):
    __tablename__ = "character_references"
    __table_args__ = (UniqueConstraint("character_id", "slot", name="uq_character_reference_slot"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    character_id: Mapped[str] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    media_key: Mapped[str] = mapped_column(String(512), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    moderation_status: Mapped[str] = mapped_column(String(32), default="approved", nullable=False)

    character: Mapped[Character] = relationship(back_populates="references")


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_jobs_user_idempotency_key"),
        Index("ix_jobs_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", server_default="queued", nullable=False)
    stage: Mapped[str] = mapped_column(String(32), default="queued", server_default="queued", nullable=False)
    progress: Mapped[float] = mapped_column(Float, default=0.0, server_default="0", nullable=False)
    request_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="jobs")


class DiaryEntry(TimestampMixin, Base):
    __tablename__ = "diary_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "local_id", name="uq_diary_entries_user_local_id"),
        Index("ix_diary_entries_user_entry_date", "user_id", "entry_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    local_id: Mapped[str] = mapped_column(String(255), nullable=False)
    entry_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    input_type: Mapped[str] = mapped_column(String(16), nullable=False)
    redacted_text: Mapped[str] = mapped_column(Text, nullable=False)
    audio_key: Mapped[str | None] = mapped_column(String(512))
    audio_delete_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    emotion_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    event_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="confirmed", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DailyDiary(TimestampMixin, Base):
    __tablename__ = "daily_diaries"
    __table_args__ = (UniqueConstraint("user_id", "diary_date", "timezone", name="uq_daily_diaries_user_date_tz"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    diary_date: Mapped[str] = mapped_column(String(10), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text)
    emotion_arc_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    cover_key: Mapped[str | None] = mapped_column(String(512))
    composite_key: Mapped[str | None] = mapped_column(String(512))
    generation_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DailyDiaryEntry(Base):
    __tablename__ = "daily_diary_entries"
    __table_args__ = (UniqueConstraint("daily_diary_id", "entry_id", name="uq_daily_diary_entries_pair"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    daily_diary_id: Mapped[str] = mapped_column(ForeignKey("daily_diaries.id", ondelete="CASCADE"), nullable=False)
    entry_id: Mapped[str] = mapped_column(ForeignKey("diary_entries.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class DiaryArtifact(TimestampMixin, Base):
    __tablename__ = "diary_artifacts"
    __table_args__ = (Index("ix_diary_artifacts_user_created_at", "user_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), unique=True, nullable=False)
    entry_id: Mapped[str | None] = mapped_column(ForeignKey("diary_entries.id", ondelete="SET NULL"), index=True)
    artifact_type: Mapped[str] = mapped_column(String(32), default="instant_comic", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    emotion_label: Mapped[str] = mapped_column(String(64), nullable=False)
    mood_score: Mapped[int] = mapped_column(Integer, nullable=False)
    transcript_redacted: Mapped[str | None] = mapped_column(Text)
    companion_note: Mapped[str] = mapped_column(Text, nullable=False)
    composite_key: Mapped[str | None] = mapped_column(String(512))
    panel_keys_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    character_snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    daily_diary_id: Mapped[str | None] = mapped_column(ForeignKey("daily_diaries.id", ondelete="SET NULL"), index=True)


class Panel(TimestampMixin, Base):
    __tablename__ = "panels"
    __table_args__ = (UniqueConstraint("artifact_id", "panel_no", name="uq_panels_artifact_panel_no"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("diary_artifacts.id", ondelete="CASCADE"), nullable=False, index=True)
    panel_no: Mapped[int] = mapped_column(Integer, nullable=False)
    storyboard_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    image_key: Mapped[str | None] = mapped_column(String(512))
    prompt_snapshot: Mapped[str | None] = mapped_column(Text)
    provider: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str | None] = mapped_column(String(128))
    seed: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="completed", nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class MemoryItem(TimestampMixin, Base):
    __tablename__ = "memory_items"
    __table_args__ = (Index("ix_memory_items_user_happened_on", "user_id", "happened_on"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    artifact_id: Mapped[str | None] = mapped_column(ForeignKey("diary_artifacts.id", ondelete="SET NULL"))
    happened_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    emotion: Mapped[str | None] = mapped_column(String(64))
    mood_score: Mapped[int | None] = mapped_column(Integer)
    embedding: Mapped[list[float] | None] = mapped_column(JSON)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)


class PetSession(Base):
    __tablename__ = "pet_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    messages_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RateLimitCounter(Base):
    __tablename__ = "rate_limit_counters"
    __table_args__ = (
        UniqueConstraint("user_id", "scope", "window_start", name="uq_rate_limit_user_scope_window"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
