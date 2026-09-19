"""Add privacy-safe user feedback submissions."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260918_0014"
down_revision: str | None = "20260918_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("contact", sa.String(length=255)),
        sa.Column("device_json", sa.JSON(), nullable=False),
        sa.Column("diagnostics_json", sa.JSON(), nullable=False),
        sa.Column("attachment_key", sa.String(length=512)),
        sa.Column("include_related_content", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="submitted"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_feedback_user_id", "feedback", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_feedback_user_id", table_name="feedback")
    op.drop_table("feedback")
