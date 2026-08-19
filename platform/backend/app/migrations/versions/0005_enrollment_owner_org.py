"""Add enrollment owner primary org snapshot.

Revision ID: 0005_enrollment_owner_primary_org
Revises: 0004_iam_permission_ux_fixes
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_enrollment_owner_org"
down_revision = "0004_iam_permission_ux_fixes"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "owner_primary_org_id" not in _columns(bind, "enrollment_request"):
        op.add_column(
            "enrollment_request",
            sa.Column("owner_primary_org_id", sa.String(64), nullable=True),
        )
        op.create_index(
            "ix_enrollment_request_owner_primary_org_id",
            "enrollment_request",
            ["owner_primary_org_id"],
        )
        op.create_foreign_key(
            "fk_enrollment_request_owner_primary_org_id_iam_org_node",
            "enrollment_request",
            "iam_org_node",
            ["owner_primary_org_id"],
            ["id"],
        )
    bind.execute(
        sa.text(
            """
            UPDATE enrollment_request
            SET owner_primary_org_id = (
                SELECT iam_principal.primary_org_id
                FROM iam_principal
                WHERE iam_principal.id = enrollment_request.owner_principal_id
            )
            WHERE owner_primary_org_id IS NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_enrollment_request_owner_primary_org_id_iam_org_node",
        "enrollment_request",
        type_="foreignkey",
    )
    op.drop_index("ix_enrollment_request_owner_primary_org_id", table_name="enrollment_request")
    op.drop_column("enrollment_request", "owner_primary_org_id")
