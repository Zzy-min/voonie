"""Add WeChat OpenID identity for mini-program login."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260908_0010"
down_revision: str | None = "20260829_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("wechat_openid", sa.String(length=128), nullable=True))
        batch.create_index("ix_users_wechat_openid", ["wechat_openid"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_wechat_openid")
        batch.drop_column("wechat_openid")
