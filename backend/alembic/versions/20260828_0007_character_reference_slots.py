"""Prevent concurrent character reference uploads from exceeding the limit."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260828_0007"
down_revision: str | None = "20260828_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("character_references") as batch:
        batch.add_column(sa.Column("slot", sa.Integer(), nullable=True))
        batch.create_unique_constraint("uq_character_reference_slot", ["character_id", "slot"])


def downgrade() -> None:
    with op.batch_alter_table("character_references") as batch:
        batch.drop_constraint("uq_character_reference_slot", type_="unique")
        batch.drop_column("slot")
