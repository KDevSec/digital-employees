from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.organization import build_closure_edges, flatten_keycloak_groups
from app.models import IamDepartment, IamDomain, IamOrgClosure, IamOrgNode, IamTeam


async def reconcile_organization_snapshot(iam_admin, session: Session) -> int:
    """Sync Keycloak groups into IamOrgNode rows and rebuild closure tables.

    Groups deleted in Keycloak are soft-deleted (status=DISABLED), never hard-deleted:
    principals and role grants reference org node ids and audit trails must survive.
    """
    rows = flatten_keycloak_groups(await iam_admin.list_groups())
    domains: set[str] = set()
    active_ids: set[str] = set()
    for raw in rows:
        domains.add(raw["domain_id"])
        active_ids.add(raw["id"])
        node = session.get(IamOrgNode, raw["id"])
        if node is None:
            node = IamOrgNode(**raw)
            session.add(node)
        else:
            for field, value in raw.items():
                if field != "id":
                    setattr(node, field, value)
    session.flush()
    for node in session.scalars(select(IamOrgNode).where(IamOrgNode.domain_id.in_(domains))).all():
        if node.id not in active_ids and node.status == "ACTIVE":
            node.status = "DISABLED"
    _mirror_org_nodes(session, rows)
    for domain_id in domains:
        rebuild_domain_closure(session, domain_id)
    session.commit()
    return len(rows)


def _mirror_org_nodes(session: Session, rows: list[dict]) -> None:
    """Mirror DOMAIN/DEPARTMENT/TEAM org nodes into IamDomain/IamDepartment/IamTeam (same id)."""
    by_id = {raw["id"]: raw for raw in rows}
    for raw in rows:
        org_id = raw["id"]
        name = raw["name"]
        status = raw.get("status", "ACTIVE")
        org_type = raw.get("org_type")
        if org_type == "DOMAIN":
            existing = session.get(IamDomain, org_id)
            if existing is None:
                session.add(IamDomain(id=org_id, name=name, status=status))
            else:
                existing.name = name
                existing.status = status
        elif org_type == "DEPARTMENT":
            existing = session.get(IamDepartment, org_id)
            if existing is None:
                session.add(IamDepartment(id=org_id, domain_id=raw["domain_id"], name=name, status=status))
            else:
                existing.domain_id = raw["domain_id"]
                existing.name = name
                existing.status = status
        elif org_type == "TEAM":
            department_id = _nearest_department_id(by_id, raw)
            if not department_id:
                continue
            existing = session.get(IamTeam, org_id)
            if existing is None:
                session.add(IamTeam(id=org_id, department_id=department_id, name=name, status=status))
            else:
                existing.department_id = department_id
                existing.name = name
                existing.status = status
    # Soft-delete mirrored departments/teams whose groups vanished from Keycloak.
    domain_ids = {raw["domain_id"] for raw in rows}
    department_ids = {raw["id"] for raw in rows if raw.get("org_type") == "DEPARTMENT"}
    team_ids = {raw["id"] for raw in rows if raw.get("org_type") == "TEAM"}
    for dept in session.scalars(select(IamDepartment).where(IamDepartment.domain_id.in_(domain_ids))).all():
        if dept.id not in department_ids and dept.status == "ACTIVE":
            dept.status = "DISABLED"
    domain_dept_ids = set(
        session.scalars(select(IamDepartment.id).where(IamDepartment.domain_id.in_(domain_ids))).all()
    )
    for team in session.scalars(select(IamTeam).where(IamTeam.department_id.in_(domain_dept_ids))).all():
        if team.id not in team_ids and team.status == "ACTIVE":
            team.status = "DISABLED"
    session.flush()


def _nearest_department_id(by_id: dict[str, dict], raw: dict) -> str | None:
    """Walk the parent chain to the nearest DEPARTMENT org node id."""
    current = raw
    seen: set[str] = set()
    while current is not None:
        cid = current.get("id")
        if cid in seen:
            break
        seen.add(cid)
        if current.get("org_type") == "DEPARTMENT":
            return cid
        parent_id = current.get("parent_id")
        current = by_id.get(parent_id) if parent_id else None
    return None


def rebuild_domain_closure(session: Session, domain_id: str) -> None:
    nodes = session.scalars(select(IamOrgNode).where(IamOrgNode.domain_id == domain_id)).all()
    node_ids = [node.id for node in nodes]
    if node_ids:
        session.execute(
            delete(IamOrgClosure).where(
                IamOrgClosure.ancestor_id.in_(node_ids),
                IamOrgClosure.descendant_id.in_(node_ids),
            )
        )
    parents = {node.id: node.parent_id for node in nodes}
    session.add_all(
        IamOrgClosure(ancestor_id=ancestor, descendant_id=descendant, depth=depth)
        for ancestor, descendant, depth in build_closure_edges(parents)
    )