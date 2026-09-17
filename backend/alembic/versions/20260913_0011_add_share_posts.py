"""Add public share posts and reactions."""

from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "20260913_0011"
down_revision: str | None = "20260908_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("share_posts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("artifact_id", sa.String(36), sa.ForeignKey("diary_artifacts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("caption", sa.String(500), nullable=False), sa.Column("tags_json", sa.JSON(), nullable=False),
        sa.Column("show_location", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("hide_date", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("is_public", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "artifact_id", name="uq_share_posts_user_artifact"))
    op.create_index("ix_share_posts_user_id", "share_posts", ["user_id"])
    op.create_index("ix_share_posts_public_created_at", "share_posts", ["is_public", "created_at"])
    op.create_table("share_reactions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("post_id", sa.String(36), sa.ForeignKey("share_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("post_id", "user_id", "kind", name="uq_share_reactions_post_user_kind"))
    op.create_index("ix_share_reactions_post_id", "share_reactions", ["post_id"])
    op.create_index("ix_share_reactions_user_id", "share_reactions", ["user_id"])


def downgrade() -> None:
    op.drop_table("share_reactions")
    op.drop_table("share_posts")
