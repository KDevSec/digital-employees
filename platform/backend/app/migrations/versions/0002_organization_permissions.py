"""Add configurable organization tree and scoped roles."""

from alembic import op
import sqlalchemy as sa

from app.database import Base
from app.domain.organization import build_closure_edges
import app.models  # noqa: F401


revision = "0002_organization_permissions"
down_revision = "0001_initial"
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
    ("permission.catalog.manage", "permission", "manage", "Manage system permission catalog", "CRITICAL", False),
    ("workbench.read", "workbench", "read", "Read workbenches", "LOW", True),
    ("workbench.approve", "workbench", "approve", "Approve workbenches", "HIGH", True),
    ("workbench.revoke", "workbench", "revoke", "Revoke workbenches", "HIGH", True),
    ("audit.operation.read", "audit", "operation.read", "Read operation audit", "HIGH", True),
    ("audit.security.read", "audit", "security.read", "Read security audit", "CRITICAL", False),
)


def _columns(bind, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)
    principal_columns = _columns(bind, "iam_principal")
    if "keycloak_user_id" not in principal_columns:
        op.add_column("iam_principal", sa.Column("keycloak_user_id", sa.String(64), nullable=True))
        op.create_unique_constraint("uq_iam_principal_keycloak_user_id", "iam_principal", ["keycloak_user_id"])
    if "primary_org_id" not in principal_columns:
        op.add_column("iam_principal", sa.Column("primary_org_id", sa.String(64), nullable=True))
        op.create_index("ix_iam_principal_primary_org_id", "iam_principal", ["primary_org_id"])
        op.create_foreign_key("fk_iam_principal_primary_org", "iam_principal", "iam_org_node", ["primary_org_id"], ["id"])
    if "authorization_version" not in principal_columns:
        op.add_column(
            "iam_principal",
            sa.Column("authorization_version", sa.Integer(), nullable=False, server_default="1"),
        )

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

    org_table = Base.metadata.tables["iam_org_node"]
    existing_orgs = set(bind.execute(sa.select(org_table.c.id)).scalars())
    parents: dict[str, str | None] = {}
    for row in bind.execute(sa.text("SELECT id, name, status FROM iam_domain")).mappings():
        parents[row["id"]] = None
        if row["id"] not in existing_orgs:
            bind.execute(
                org_table.insert().values(
                    id=row["id"], keycloak_group_id=f"legacy-{row['id']}", domain_id=row["id"],
                    parent_id=None, org_code=row["id"], org_type="DOMAIN", name=row["name"],
                    status=row["status"], sort_order=0, version=1,
                )
            )
    for row in bind.execute(sa.text("SELECT id, domain_id, name, status FROM iam_department")).mappings():
        parents[row["id"]] = row["domain_id"]
        if row["id"] not in existing_orgs:
            bind.execute(
                org_table.insert().values(
                    id=row["id"], keycloak_group_id=f"legacy-{row['id']}", domain_id=row["domain_id"],
                    parent_id=row["domain_id"], org_code=row["id"], org_type="DEPARTMENT", name=row["name"],
                    status=row["status"], sort_order=0, version=1,
                )
            )
    department_domains = dict(bind.execute(sa.text("SELECT id, domain_id FROM iam_department")).all())
    for row in bind.execute(sa.text("SELECT id, department_id, name, status FROM iam_team")).mappings():
        parents[row["id"]] = row["department_id"]
        if row["id"] not in existing_orgs:
            bind.execute(
                org_table.insert().values(
                    id=row["id"], keycloak_group_id=f"legacy-{row['id']}",
                    domain_id=department_domains[row["department_id"]], parent_id=row["department_id"],
                    org_code=row["id"], org_type="TEAM", name=row["name"], status=row["status"],
                    sort_order=0, version=1,
                )
            )

    closure_table = Base.metadata.tables["iam_org_closure"]
    bind.execute(closure_table.delete())
    if parents:
        bind.execute(
            closure_table.insert(),
            [
                {"ancestor_id": ancestor, "descendant_id": descendant, "depth": depth}
                for ancestor, descendant, depth in build_closure_edges(parents)
            ],
        )

    membership_table = Base.metadata.tables["iam_principal_org"]
    principals = bind.execute(
        sa.text("SELECT id, domain_id, department_id, team_id FROM iam_principal")
    ).mappings()
    for principal in principals:
        primary_org = principal["team_id"] or principal["department_id"] or principal["domain_id"]
        if not primary_org:
            continue
        active = bind.execute(
            sa.select(membership_table.c.id).where(
                membership_table.c.principal_id == principal["id"],
                membership_table.c.membership_type == "PRIMARY",
                membership_table.c.status == "ACTIVE",
            )
        ).scalar_one_or_none()
        if active is None:
            bind.execute(
                membership_table.insert().values(
                    id=__import__("uuid").uuid4().hex,
                    principal_id=principal["id"], org_id=primary_org,
                    membership_type="PRIMARY", status="ACTIVE",
                )
            )
        bind.execute(
            sa.text("UPDATE iam_principal SET primary_org_id=:org WHERE id=:principal"),
            {"org": primary_org, "principal": principal["id"]},
        )


def downgrade() -> None:
    # The rollout keeps V0.1 tables as the rollback source. Destructive downgrade is intentionally unsupported.
    pass
