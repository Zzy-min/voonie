"""Create the initial Voonie persistence schema."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260827_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def id_column() -> sa.Column:
    return sa.Column("id", sa.String(length=36), primary_key=True)


def created_at_column() -> sa.Column:
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "users",
        id_column(),
        sa.Column("device_id", sa.String(length=255), nullable=False),
        sa.Column("memory_opt_in", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        created_at_column(),
        sa.UniqueConstraint("device_id"),
    )
    op.create_table(
        "refresh_tokens",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hashed_token", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        created_at_column(),
        sa.UniqueConstraint("hashed_token"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_table(
        "characters",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("appearance_prompt", sa.Text(), nullable=False),
        sa.Column("style_preset", sa.String(length=64), nullable=False),
        sa.Column("bible_json", sa.JSON(), nullable=False),
        sa.Column("reference_image_key", sa.String(length=512)),
        sa.Column("seed", sa.Integer()),
        created_at_column(),
    )
    op.create_index("ix_characters_user_id", "characters", ["user_id"])
    op.create_table(
        "jobs",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="queued", nullable=False),
        sa.Column("stage", sa.String(length=32), server_default="queued", nullable=False),
        sa.Column("progress", sa.Float(), server_default="0", nullable=False),
        sa.Column("request_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("idempotency_key", sa.String(length=255)),
        created_at_column(),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_jobs_user_idempotency_key"),
    )
    op.create_index("ix_jobs_user_created_at", "jobs", ["user_id", "created_at"])
    op.create_table(
        "diary_artifacts",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("emotion_label", sa.String(length=64), nullable=False),
        sa.Column("mood_score", sa.Integer(), nullable=False),
        sa.Column("transcript_redacted", sa.Text()),
        sa.Column("companion_note", sa.Text(), nullable=False),
        sa.Column("composite_key", sa.String(length=512)),
        sa.Column("panel_keys_json", sa.JSON(), nullable=False),
        created_at_column(),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_diary_artifacts_expires_at", "diary_artifacts", ["expires_at"])
    op.create_index("ix_diary_artifacts_user_created_at", "diary_artifacts", ["user_id", "created_at"])
    op.create_table(
        "memory_items",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("artifact_id", sa.String(length=36), sa.ForeignKey("diary_artifacts.id", ondelete="SET NULL")),
        sa.Column("happened_on", sa.DateTime(timezone=True)),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.String(length=500), nullable=False),
        sa.Column("emotion", sa.String(length=64)),
        sa.Column("mood_score", sa.Integer()),
        sa.Column("embedding", sa.JSON()),
        sa.Column("tags_json", sa.JSON(), nullable=False),
        created_at_column(),
    )
    op.create_index("ix_memory_items_user_happened_on", "memory_items", ["user_id", "happened_on"])
    op.create_table(
        "pet_sessions",
        id_column(),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("messages_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pet_sessions_user_id", "pet_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_pet_sessions_user_id", table_name="pet_sessions")
    op.drop_table("pet_sessions")
    op.drop_index("ix_memory_items_user_happened_on", table_name="memory_items")
    op.drop_table("memory_items")
    op.drop_index("ix_diary_artifacts_user_created_at", table_name="diary_artifacts")
    op.drop_index("ix_diary_artifacts_expires_at", table_name="diary_artifacts")
    op.drop_table("diary_artifacts")
    op.drop_index("ix_jobs_user_created_at", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_characters_user_id", table_name="characters")
    op.drop_table("characters")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("users")

