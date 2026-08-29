"""Add persistent entries and versioned comic panels."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260827_0002"
down_revision: str | None = "20260827_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "diary_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("local_id", sa.String(255), nullable=False),
        sa.Column("entry_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("input_type", sa.String(16), nullable=False),
        sa.Column("redacted_text", sa.Text(), nullable=False),
        sa.Column("audio_key", sa.String(512)),
        sa.Column("audio_delete_after", sa.DateTime(timezone=True)),
        sa.Column("emotion_json", sa.JSON(), nullable=False),
        sa.Column("event_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "local_id", name="uq_diary_entries_user_local_id"),
    )
    op.create_index("ix_diary_entries_user_entry_date", "diary_entries", ["user_id", "entry_date"])
    with op.batch_alter_table("diary_artifacts") as batch:
        batch.add_column(sa.Column("entry_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("artifact_type", sa.String(32), server_default="instant_comic", nullable=False))
        batch.add_column(sa.Column("version", sa.Integer(), server_default="1", nullable=False))
        batch.create_foreign_key("fk_diary_artifacts_entry_id", "diary_entries", ["entry_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_diary_artifacts_entry_id", ["entry_id"])
    op.create_table(
        "panels",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("diary_artifacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("panel_no", sa.Integer(), nullable=False),
        sa.Column("storyboard_json", sa.JSON(), nullable=False),
        sa.Column("image_key", sa.String(512)),
        sa.Column("prompt_snapshot", sa.Text()),
        sa.Column("provider", sa.String(64)),
        sa.Column("model", sa.String(128)),
        sa.Column("seed", sa.Integer()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("artifact_id", "panel_no", name="uq_panels_artifact_panel_no"),
    )
    op.create_index("ix_panels_artifact_id", "panels", ["artifact_id"])


def downgrade() -> None:
    op.drop_index("ix_panels_artifact_id", table_name="panels")
    op.drop_table("panels")
    with op.batch_alter_table("diary_artifacts") as batch:
        batch.drop_index("ix_diary_artifacts_entry_id")
        batch.drop_constraint("fk_diary_artifacts_entry_id", type_="foreignkey")
        batch.drop_column("version")
        batch.drop_column("artifact_type")
        batch.drop_column("entry_id")
    op.drop_index("ix_diary_entries_user_entry_date", table_name="diary_entries")
    op.drop_table("diary_entries")
