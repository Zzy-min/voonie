"""Add user preference fields."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260828_0004"
down_revision: str | None = "20260827_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("nickname", sa.String(32), server_default="小主人", nullable=False))
        batch.add_column(
            sa.Column(
                "quote",
                sa.String(120),
                server_default="生活或许忙碌，但记得停下来，听一听自己的声音。",
                nullable=False,
            )
        )
        batch.add_column(sa.Column("quote_note", sa.String(80), server_default="今天也值得被好好收藏。", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("quote_note")
        batch.drop_column("quote")
        batch.drop_column("nickname")
