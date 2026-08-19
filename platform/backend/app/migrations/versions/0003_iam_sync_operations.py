"""Add IAM sync operation bookkeeping.

Revision ID: 0003_iam_sync_operations
Revises: 0002_organization_permissions
Create Date: 2026-08-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_iam_sync_operations"
down_revision = "0002_organization_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("iam_sync_operation"):
        return
    op.create_table(
        "iam_sync_operation",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("operation_type", sa.String(60), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_retry_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_iam_sync_operation_idempotency_key", "iam_sync_operation", ["idempotency_key"], unique=True)
    op.create_index("ix_iam_sync_operation_operation_type", "iam_sync_operation", ["operation_type"])
    op.create_index("ix_iam_sync_operation_status", "iam_sync_operation", ["status"])


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("iam_sync_operation"):
        return
    op.drop_index("ix_iam_sync_operation_status", table_name="iam_sync_operation")
    op.drop_index("ix_iam_sync_operation_operation_type", table_name="iam_sync_operation")
    op.drop_index("ix_iam_sync_operation_idempotency_key", table_name="iam_sync_operation")
    op.drop_table("iam_sync_operation")
