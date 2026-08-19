from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal
from app.domain.authorization import RoleCode, ScopeType
from app.models import IamOrgClosure, IamOrgNode, IamPrincipal


def has_global_permission(identity: AuthenticatedPrincipal, permission: str) -> bool:
    return any(
        _role_has_permission(assignment.role, permission)
        and assignment.data_scope.scope_type is ScopeType.GLOBAL
        for assignment in identity.authorization.assignments
    )


def _role_has_permission(role: RoleCode, permission: str) -> bool:
    from app.domain.authorization import ROLE_PERMISSIONS

    return permission in ROLE_PERMISSIONS[role]


def descendant_org_ids(session: Session, org_ids: Iterable[str]) -> set[str]:
    roots = {org_id for org_id in org_ids if org_id}
    if not roots:
        return set()
    return set(
        session.scalars(
            select(IamOrgClosure.descendant_id).where(IamOrgClosure.ancestor_id.in_(roots))
        ).all()
    ) | roots


def visible_org_ids(session: Session, identity: AuthenticatedPrincipal, permission: str) -> set[str] | None:
    roots = {
        grant.scope_org_id
        for grant in identity.authorization.scoped_grants
        if permission in grant.permissions and grant.scope_org_id
    }
    for assignment in identity.authorization.assignments:
        if not _role_has_permission(assignment.role, permission):
            continue
        scope = assignment.data_scope
        if scope.scope_type in {ScopeType.GLOBAL, ScopeType.ALL_DEPARTMENTS}:
            return None
        if scope.scope_type is ScopeType.DEPARTMENT_SET:
            roots.update(scope.department_ids)
    return descendant_org_ids(session, roots)


def can_review_scoped(session: Session, identity: AuthenticatedPrincipal, owner_primary_org_id: str | None) -> bool:
    if has_global_permission(identity, "workbench.enrollment.review"):
        return True
    if not owner_primary_org_id:
        return False
    visible = visible_org_ids(session, identity, "workbench.enrollment.review")
    return visible is not None and owner_primary_org_id in visible


def org_path(session: Session, org_id: str | None) -> tuple[str, list[dict[str, str]]]:
    if not org_id:
        return "", []
    edges = session.scalars(
        select(IamOrgClosure)
        .where(IamOrgClosure.descendant_id == org_id)
        .order_by(IamOrgClosure.depth.desc())
    ).all()
    nodes = [session.get(IamOrgNode, edge.ancestor_id) for edge in edges]
    valid_nodes = [node for node in nodes if node is not None]
    return (
        "-".join(node.name for node in valid_nodes),
        [{"id": node.id, "name": node.name, "org_type": node.org_type} for node in valid_nodes],
    )


def owner_org_context(
    session: Session, principal: IamPrincipal | None, primary_org_id: str | None = None
) -> tuple[str, str, list[dict[str, str]]]:
    if principal is None:
        return "", "", []
    path, nodes = org_path(session, primary_org_id or principal.primary_org_id)
    return principal.display_name or principal.username, path, nodes
