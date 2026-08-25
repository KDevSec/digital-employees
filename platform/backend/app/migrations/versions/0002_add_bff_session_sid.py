"""Add sid column to bff_session for OIDC back-channel logout matching.

Defensive: 0001_initial builds the schema via Base.metadata.create_all, so a
fresh database already has the column/index from the model. This migration only
adds them when absent (existing databases migrated by an older 0001).
"""

from alembic import op
import sqlalchemy as sa


revision = "0002_add_bff_session_sid"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("bff_session")}
    if "sid" not in columns:
        op.add_column("bff_session", sa.Column("sid", sa.String(length=255), nullable=True))
    existing_indexes = {idx["name"] for idx in inspector.get_indexes("bff_session")}
    if "ix_bff_session_sid" not in existing_indexes:
        op.create_index("ix_bff_session_sid", "bff_session", ["sid"])


def downgrade() -> None:
    op.drop_index("ix_bff_session_sid", table_name="bff_session")
    op.drop_column("bff_session", "sid")
