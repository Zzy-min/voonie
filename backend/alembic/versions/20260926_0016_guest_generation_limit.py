"""Persist successful guest generations across diary deletion.

Revision ID: 20260926_0016
Revises: 20260918_0015
"""
from alembic import op
import sqlalchemy as sa

revision = "20260926_0016"
down_revision = "20260918_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("guest_generated_count", sa.Integer(), server_default="0", nullable=False))
    op.execute("""
        UPDATE users SET guest_generated_count = (
            SELECT COUNT(*) FROM jobs
            WHERE jobs.user_id = users.id AND jobs.type IN ('comic', 'storybook') AND jobs.status = 'done'
        ) WHERE users.wechat_openid IS NULL
    """)


def downgrade() -> None:
    op.drop_column("users", "guest_generated_count")
