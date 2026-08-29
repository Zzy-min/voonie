"""Add email and password_hash for user authentication."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260829_0008"
down_revision: str | None = "20260828_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("email", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("password_hash", sa.String(length=255), nullable=True))
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True))
        batch.alter_column("device_id", existing_type=sa.String(length=255), nullable=True)
        batch.create_index("ix_users_email", ["email"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_email")
        batch.drop_column("updated_at")
        batch.drop_column("password_hash")
        batch.drop_column("email")
