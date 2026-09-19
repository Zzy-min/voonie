"""Add verified phone identity for WeChat mini-program login."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260918_0013"
down_revision: str | None = "20260914_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("phone", sa.String(length=32), nullable=True))
        batch.create_index("ix_users_phone", ["phone"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_phone")
        batch.drop_column("phone")
