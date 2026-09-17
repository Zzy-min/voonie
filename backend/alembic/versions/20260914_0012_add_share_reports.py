"""Add idempotent share reports."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260914_0012"
down_revision: str | None = "20260913_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "share_reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("reporter_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.String(36), sa.ForeignKey("share_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column("detail", sa.String(500)),
        sa.Column("status", sa.String(16), server_default="submitted", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("reporter_user_id", "post_id", "reason", name="uq_share_reports_reporter_post_reason"),
    )
    op.create_index("ix_share_reports_reporter_user_id", "share_reports", ["reporter_user_id"])
    op.create_index("ix_share_reports_post_id", "share_reports", ["post_id"])


def downgrade() -> None:
    op.drop_table("share_reports")
