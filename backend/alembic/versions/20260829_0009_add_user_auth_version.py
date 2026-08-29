"""Add per-user authentication version for access-token revocation."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260829_0009"
down_revision: str | None = "20260829_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("auth_version", sa.Integer(), server_default="0", nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("auth_version")
