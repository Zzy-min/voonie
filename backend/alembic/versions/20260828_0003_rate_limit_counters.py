"""Add persistent per-user rate limit counters."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260828_0005"
down_revision: str | None = "20260828_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_counters",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("user_id", "scope", "window_start", name="uq_rate_limit_user_scope_window"),
    )
    op.create_index("ix_rate_limit_counters_user_id", "rate_limit_counters", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_counters_user_id", table_name="rate_limit_counters")
    op.drop_table("rate_limit_counters")
