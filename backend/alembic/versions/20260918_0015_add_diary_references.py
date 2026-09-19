"""add diary references

Revision ID: 20260918_0015
Revises: 20260918_0014
"""
from alembic import op
import sqlalchemy as sa

revision = "20260918_0015"
down_revision = "20260918_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "diary_references",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("entry_id", sa.String(length=36), nullable=False),
        sa.Column("media_key", sa.String(length=512), nullable=False),
        sa.Column("reference_type", sa.String(length=24), server_default="combined", nullable=False),
        sa.Column("paragraph_anchor", sa.String(length=500), nullable=True),
        sa.Column("include_in_content", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["entry_id"], ["diary_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_diary_references_user_id", "diary_references", ["user_id"])
    op.create_index("ix_diary_references_entry_id", "diary_references", ["entry_id"])


def downgrade() -> None:
    op.drop_index("ix_diary_references_entry_id", table_name="diary_references")
    op.drop_index("ix_diary_references_user_id", table_name="diary_references")
    op.drop_table("diary_references")
