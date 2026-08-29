"""Add character references and daily diaries."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260827_0003"
down_revision: str | None = "20260827_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("characters") as batch:
        batch.add_column(sa.Column("version", sa.Integer(), server_default="1", nullable=False))
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table(
        "character_references",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("character_id", sa.String(36), sa.ForeignKey("characters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("media_key", sa.String(512), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("moderation_status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_character_references_character_id", "character_references", ["character_id"])
    op.create_table(
        "daily_diaries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("diary_date", sa.String(10), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("title", sa.String(255)),
        sa.Column("summary", sa.Text()),
        sa.Column("emotion_arc_json", sa.JSON(), nullable=False),
        sa.Column("cover_key", sa.String(512)),
        sa.Column("composite_key", sa.String(512)),
        sa.Column("generation_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "diary_date", "timezone", name="uq_daily_diaries_user_date_tz"),
    )
    op.create_table(
        "daily_diary_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("daily_diary_id", sa.String(36), sa.ForeignKey("daily_diaries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_id", sa.String(36), sa.ForeignKey("diary_entries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("daily_diary_id", "entry_id", name="uq_daily_diary_entries_pair"),
    )
    with op.batch_alter_table("diary_artifacts") as batch:
        batch.add_column(sa.Column("character_snapshot_json", sa.JSON(), server_default="{}", nullable=False))
        batch.add_column(sa.Column("daily_diary_id", sa.String(36), nullable=True))
        batch.create_foreign_key(
            "fk_diary_artifacts_daily_diary_id",
            "daily_diaries",
            ["daily_diary_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch.create_index("ix_diary_artifacts_daily_diary_id", ["daily_diary_id"])


def downgrade() -> None:
    with op.batch_alter_table("diary_artifacts") as batch:
        batch.drop_index("ix_diary_artifacts_daily_diary_id")
        batch.drop_constraint("fk_diary_artifacts_daily_diary_id", type_="foreignkey")
        batch.drop_column("daily_diary_id")
        batch.drop_column("character_snapshot_json")
    op.drop_table("daily_diary_entries")
    op.drop_table("daily_diaries")
    op.drop_index("ix_character_references_character_id", table_name="character_references")
    op.drop_table("character_references")
    with op.batch_alter_table("characters") as batch:
        batch.drop_column("updated_at")
        batch.drop_column("version")
