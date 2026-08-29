"""Add installation proof for device authentication."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260828_0006"
down_revision: str | None = "20260828_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("device_secret_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("device_secret_hash")
