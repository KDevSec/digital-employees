"""Add audit.read and system.logs.read permissions.

Revision ID: 0006_audit_logging_permissions
Revises: 0005_enrollment_owner_org
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa

from app.database import Base
import app.models  # noqa: F401


revision = "0006_audit_logging_permissions"
down_revision = "0005_enrollment_owner_org"
branch_labels = None
depends_on = None


PERMISSIONS = (
    ("audit.read", "audit", "read", "Read audit events", "CRITICAL", False),
    ("system.logs.read", "system", "logs.read", "Read application logs", "CRITICAL", False),
)


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)
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
    pass
