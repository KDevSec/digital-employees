"""Create the V0.1 platform schema.

Single squashed migration: all tables via create_all + permission seeds + query indexes.
"""

from alembic import op
import sqlalchemy as sa

from app.database import Base
import app.models  # noqa: F401

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


PERMISSIONS = (
    ("organization.read", "organization", "read", "Read organizations", "LOW", True),
    ("organization.create", "organization", "create", "Create organizations", "HIGH", True),
    ("organization.update", "organization", "update", "Update organizations", "HIGH", True),
    ("organization.move", "organization", "move", "Move organization branches", "HIGH", True),
    ("organization.archive", "organization", "archive", "Archive organizations", "HIGH", True),
    ("organization.member.read", "organization", "member.read", "Read organization members", "MEDIUM", True),
    ("organization.member.manage", "organization", "member.manage", "Manage organization members", "HIGH", True),
    ("role.read", "role", "read", "Read roles and grants", "MEDIUM", True),
    ("role.create", "role", "create", "Create roles", "HIGH", True),
    ("role.update", "role", "update", "Update roles", "HIGH", True),
    ("role.assign", "role", "assign", "Assign roles", "CRITICAL", True),
    ("role.manage", "role", "manage", "Manage roles and assignments", "CRITICAL", True),
    ("permission.catalog.manage", "permission", "manage", "Manage system permission catalog", "CRITICAL", False),
    ("workbench.read", "workbench", "read", "Read workbenches", "LOW", True),
    ("workbench.approve", "workbench", "approve", "Approve workbenches", "HIGH", True),
    ("workbench.revoke", "workbench", "revoke", "Revoke workbenches", "HIGH", True),
    ("workbench.enroll", "workbench", "enroll", "Enroll workbenches", "MEDIUM", True),
    ("workbench.enrollment.review", "workbench", "enrollment.review", "Review workbench enrollments", "HIGH", True),
    ("package.manage", "package", "manage", "Manage install packages", "HIGH", True),
    ("audit.operation.read", "audit", "operation.read", "Read operation audit", "HIGH", True),
    ("audit.security.read", "audit", "security.read", "Read security audit", "CRITICAL", False),
    ("audit.all.read", "audit", "all.read", "Read all audit events", "CRITICAL", True),
    ("audit.read", "audit", "read", "Read audit events", "CRITICAL", False),
    ("system.logs.read", "system", "logs.read", "Read application logs", "CRITICAL", False),
    ("platform.settings.manage", "platform", "settings.manage", "Manage platform settings", "HIGH", True),
    ("feedback.manage", "feedback", "manage", "管理与处置问题反馈", "HIGH", False),
)


INDEXES = (
    ("ix_iam_org_closure_ancestor", "iam_org_closure", ["ancestor_id"]),
    ("ix_iam_principal_status", "iam_principal", ["status"]),
    ("ix_role_assignment_role_status", "role_assignment", ["role_code", "status"]),
    ("ix_scoped_role_subject", "scoped_role_assignment", ["subject_type", "subject_id", "status"]),
)


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)

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

    inspector = sa.inspect(bind)
    existing_indexes = {
        (table, idx["name"])
        for table in inspector.get_table_names()
        for idx in inspector.get_indexes(table)
    }
    for index_name, table_name, columns in INDEXES:
        if (table_name, index_name) not in existing_indexes:
            op.create_index(index_name, table_name, columns)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
