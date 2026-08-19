"""Add bff_session.id_token and complete the permission catalog.

Revision ID: 0004_iam_permission_ux_fixes
Revises: 0003_iam_sync_operations
Create Date: 2026-08-17
"""
from alembic import op
import sqlalchemy as sa

from app.database import Base
import app.models  # noqa: F401


revision = "0004_iam_permission_ux_fixes"
down_revision = "0003_iam_sync_operations"
branch_labels = None
depends_on = None


PERMISSIONS = (
    ("role.manage", "role", "manage", "Manage roles and assignments", "CRITICAL", True),
    ("platform.settings.manage", "platform", "settings.manage", "Manage platform settings", "HIGH", True),
    ("workbench.enroll", "workbench", "enroll", "Enroll workbenches", "MEDIUM", True),
    ("workbench.enrollment.review", "workbench", "enrollment.review", "Review workbench enrollments", "HIGH", True),
    ("package.manage", "package", "manage", "Manage install packages", "HIGH", True),
    ("audit.all.read", "audit", "all.read", "Read all audit events", "CRITICAL", True),
)


def _columns(bind, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)

    if "id_token" not in _columns(bind, "bff_session"):
        op.add_column("bff_session", sa.Column("id_token", sa.Text(), nullable=True))

    permission_table = Base.metadata.tables["permission_definition"]
    for code, resource_type, action, description, risk_level, delegable in PERMISSIONS:
        exists = bind.execute(
            sa.select(permission_table.c.code).where(permission_table.c.code == code)
        ).scalar_one_or_none()
        if exists is None:
            bind.execute(
                permission_table.insert().values(
                    code=code,
                    resource_type=resource_type,
                    action=action,
                    description=description,
                    risk_level=risk_level,
                    delegable=delegable,
                    status="ACTIVE",
                )
            )


def downgrade() -> None:
    op.drop_column("bff_session", "id_token")
