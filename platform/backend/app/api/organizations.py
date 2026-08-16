from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.database import get_session
from app.errors import ApiError
from app.models import IamOrgClosure, IamOrgNode, IamPrincipal, IamPrincipalOrg


router = APIRouter()


class OrganizationCreate(BaseModel):
    parent_id: str
    org_code: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    org_type: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    sort_order: int = Field(default=0, ge=-100000, le=100000)


class OrganizationUpdate(BaseModel):
    version: int = Field(ge=1)
    org_code: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"^[A-Za-z0-9._-]+$")
    org_type: str | None = Field(default=None, min_length=1, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    sort_order: int | None = Field(default=None, ge=-100000, le=100000)


class OrganizationMove(BaseModel):
    version: int = Field(ge=1)
    new_parent_id: str


class MembershipChange(BaseModel):
    org_id: str


def org_json(node: IamOrgNode) -> dict:
    return {
        "id": node.id,
        "keycloak_group_id": node.keycloak_group_id,
        "domain_id": node.domain_id,
        "parent_id": node.parent_id,
        "org_code": node.org_code,
        "org_type": node.org_type,
        "name": node.name,
        "status": node.status,
        "sort_order": node.sort_order,
        "version": node.version,
    }


def keycloak_group_payload(node: IamOrgNode) -> dict:
    return {
        "id": node.keycloak_group_id,
        "name": node.name,
        "attributes": {
            "org_id": [node.id],
            "org_code": [node.org_code],
            "org_type": [node.org_type],
            "status": [node.status],
            "sort_order": [str(node.sort_order)],
        },
    }


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
    from app.domain.organization import build_closure_edges

    session.add_all(
        IamOrgClosure(ancestor_id=ancestor, descendant_id=descendant, depth=depth)
        for ancestor, descendant, depth in build_closure_edges(parents)
    )


async def reconcile_organization_snapshot(request: Request, session: Session) -> int:
    from app.domain.organization import flatten_keycloak_groups

    rows = flatten_keycloak_groups(await request.app.state.iam_admin.list_groups())
    domains: set[str] = set()
    for raw in rows:
        domains.add(raw["domain_id"])
        node = session.get(IamOrgNode, raw["id"])
        if node is None:
            node = IamOrgNode(**raw)
            session.add(node)
        else:
            for field, value in raw.items():
                if field != "id":
                    setattr(node, field, value)
    session.flush()
    for domain_id in domains:
        rebuild_domain_closure(session, domain_id)
    session.commit()
    return len(rows)


@router.post("/api/v1/org-nodes", status_code=status.HTTP_201_CREATED)
async def create_organization(
    body: OrganizationCreate,
    request: Request,
    idempotency_key: str = Header(min_length=1, max_length=200, alias="Idempotency-Key"),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    parent = session.get(IamOrgNode, body.parent_id)
    if parent is None or parent.status != "ACTIVE":
        raise ApiError(404, "ORG_PARENT_NOT_FOUND", "Active parent organization not found")
    duplicate = session.scalar(
        select(IamOrgNode).where(
            IamOrgNode.domain_id == parent.domain_id,
            IamOrgNode.org_code == body.org_code,
        )
    )
    if duplicate:
        return org_json(duplicate)
    node_id = str(uuid4())
    payload = {
        "name": body.name,
        "attributes": {
            "org_id": [node_id],
            "org_code": [body.org_code],
            "org_type": [body.org_type],
            "status": ["ACTIVE"],
            "sort_order": [str(body.sort_order)],
            "idempotency_key": [idempotency_key],
        },
    }
    if request.app.state.settings.testing:
        keycloak_group_id = f"test-{node_id}"
    else:
        keycloak_group_id = await request.app.state.iam_admin.create_group(parent.keycloak_group_id, payload)
    node = IamOrgNode(
        id=node_id,
        keycloak_group_id=keycloak_group_id,
        domain_id=parent.domain_id,
        parent_id=parent.id,
        org_code=body.org_code,
        org_type=body.org_type,
        name=body.name,
        sort_order=body.sort_order,
    )
    session.add(node)
    session.flush()
    ancestors = session.scalars(
        select(IamOrgClosure).where(IamOrgClosure.descendant_id == parent.id)
    ).all()
    session.add(IamOrgClosure(ancestor_id=node.id, descendant_id=node.id, depth=0))
    for edge in ancestors:
        session.add(
            IamOrgClosure(
                ancestor_id=edge.ancestor_id,
                descendant_id=node.id,
                depth=edge.depth + 1,
            )
        )
    session.commit()
    return org_json(node)


@router.get("/api/v1/org-nodes/tree")
async def organization_tree(
    request: Request,
    parent_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> list[dict]:
    require_permission(identity, "role.manage")
    if not request.app.state.settings.testing:
        legacy = session.scalar(
            select(IamOrgNode.id).where(IamOrgNode.keycloak_group_id.like("legacy-%")).limit(1)
        )
        if legacy is not None:
            await reconcile_organization_snapshot(request, session)
    statement = select(IamOrgNode).where(IamOrgNode.parent_id == parent_id).order_by(
        IamOrgNode.sort_order, IamOrgNode.name
    )
    return [org_json(row) for row in session.scalars(statement.limit(limit)).all()]


@router.post("/api/v1/iam/reconcile-organizations")
async def reconcile_organizations(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    count = await reconcile_organization_snapshot(request, session)
    return {"synchronized": count, "status": "SYNCED"}


@router.patch("/api/v1/org-nodes/{org_id}")
async def update_organization(
    org_id: str,
    body: OrganizationUpdate,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    node = session.get(IamOrgNode, org_id)
    if node is None:
        raise ApiError(404, "ORG_NOT_FOUND", "Organization not found")
    if node.version != body.version:
        raise ApiError(409, "VERSION_CONFLICT", "Organization was changed by another administrator")
    for field, value in body.model_dump(exclude={"version"}, exclude_none=True).items():
        setattr(node, field, value)
    if not request.app.state.settings.testing:
        await request.app.state.iam_admin.update_group(node.keycloak_group_id, keycloak_group_payload(node))
    node.version += 1
    session.commit()
    return org_json(node)


@router.post("/api/v1/org-nodes/{org_id}/move")
async def move_organization(
    org_id: str,
    body: OrganizationMove,
    request: Request,
    idempotency_key: str = Header(min_length=1, max_length=200, alias="Idempotency-Key"),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    del idempotency_key
    require_permission(identity, "role.manage")
    node = session.get(IamOrgNode, org_id)
    parent = session.get(IamOrgNode, body.new_parent_id)
    if node is None or parent is None:
        raise ApiError(404, "ORG_NOT_FOUND", "Organization or target parent not found")
    if node.version != body.version:
        raise ApiError(409, "VERSION_CONFLICT", "Organization was changed by another administrator")
    if node.domain_id != parent.domain_id:
        raise ApiError(422, "ORG_CROSS_DOMAIN_MOVE", "Organizations cannot be moved across domains")
    descendant = session.get(IamOrgClosure, (node.id, parent.id))
    if descendant is not None:
        raise ApiError(422, "ORG_CYCLE", "Organization move would create a cycle")
    if parent.status != "ACTIVE":
        raise ApiError(409, "ORG_PARENT_INACTIVE", "Target parent is not active")
    if not request.app.state.settings.testing:
        await request.app.state.iam_admin.move_group(node.keycloak_group_id, parent.keycloak_group_id)
    node.parent_id = parent.id
    node.version += 1
    rebuild_domain_closure(session, node.domain_id)
    session.commit()
    return org_json(node)


@router.get("/api/v1/org-nodes/{org_id}")
async def organization_detail(
    org_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    node = session.get(IamOrgNode, org_id)
    if node is None:
        raise ApiError(404, "ORG_NOT_FOUND", "Organization not found")
    edges = session.scalars(
        select(IamOrgClosure)
        .where(IamOrgClosure.descendant_id == org_id, IamOrgClosure.depth > 0)
        .order_by(IamOrgClosure.depth.desc())
    ).all()
    result = org_json(node)
    result["ancestors"] = [edge.ancestor_id for edge in edges]
    return result


def _active_membership(session: Session, principal_id: str, membership_type: str) -> IamPrincipalOrg | None:
    return session.scalar(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.membership_type == membership_type,
            IamPrincipalOrg.status == "ACTIVE",
        )
    )


@router.put("/api/v1/principals/{principal_id}/primary-org")
async def set_primary_organization(
    principal_id: str,
    body: MembershipChange,
    request: Request,
    idempotency_key: str = Header(min_length=1, max_length=200, alias="Idempotency-Key"),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    del idempotency_key
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, principal_id)
    org = session.get(IamOrgNode, body.org_id)
    if principal is None or org is None or org.status != "ACTIVE":
        raise ApiError(404, "PRINCIPAL_OR_ORG_NOT_FOUND", "Active principal and organization are required")
    if principal.domain_id != org.domain_id:
        raise ApiError(422, "ORG_DOMAIN_MISMATCH", "Principal and organization must share a domain")
    collaboration = session.scalar(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.org_id == org.id,
            IamPrincipalOrg.status == "ACTIVE",
        )
    )
    if collaboration and collaboration.membership_type != "PRIMARY":
        raise ApiError(409, "ORG_MEMBERSHIP_OVERLAP", "Primary organization cannot also be a collaboration")
    current = _active_membership(session, principal_id, "PRIMARY")
    if not request.app.state.settings.testing:
        if not principal.keycloak_user_id:
            raise ApiError(409, "KEYCLOAK_USER_ID_MISSING", "Principal has not been synchronized from Keycloak")
        await request.app.state.iam_admin.add_user_to_group(principal.keycloak_user_id, org.keycloak_group_id)
        await request.app.state.iam_admin.update_user_attributes(
            principal.keycloak_user_id, {"primary_org_id": [org.id]}
        )
        if current and current.org_id != org.id:
            old_org = session.get(IamOrgNode, current.org_id)
            if old_org:
                await request.app.state.iam_admin.remove_user_from_group(
                    principal.keycloak_user_id, old_org.keycloak_group_id
                )
    if current and current.org_id != org.id:
        current.status = "REVOKED"
        current.valid_to = __import__("datetime").datetime.now(__import__("datetime").UTC)
    if current is None or current.org_id != org.id:
        session.add(IamPrincipalOrg(principal_id=principal_id, org_id=org.id, membership_type="PRIMARY"))
    principal.primary_org_id = org.id
    principal.authorization_version += 1
    session.commit()
    return {"principal_id": principal.id, "primary_org_id": org.id, "authorization_version": principal.authorization_version}


@router.post("/api/v1/principals/{principal_id}/collaborations", status_code=status.HTTP_201_CREATED)
async def add_collaboration(
    principal_id: str,
    body: MembershipChange,
    request: Request,
    idempotency_key: str = Header(min_length=1, max_length=200, alias="Idempotency-Key"),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    del idempotency_key
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, principal_id)
    org = session.get(IamOrgNode, body.org_id)
    if principal is None or org is None or org.status != "ACTIVE":
        raise ApiError(404, "PRINCIPAL_OR_ORG_NOT_FOUND", "Active principal and organization are required")
    if principal.primary_org_id == org.id:
        raise ApiError(409, "ORG_MEMBERSHIP_OVERLAP", "Primary organization cannot also be a collaboration")
    existing = session.scalar(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.org_id == org.id,
            IamPrincipalOrg.status == "ACTIVE",
        )
    )
    if existing:
        return {"principal_id": principal_id, "org_id": org.id, "membership_type": existing.membership_type}
    if not request.app.state.settings.testing:
        if not principal.keycloak_user_id:
            raise ApiError(409, "KEYCLOAK_USER_ID_MISSING", "Principal has not been synchronized from Keycloak")
        await request.app.state.iam_admin.add_user_to_group(principal.keycloak_user_id, org.keycloak_group_id)
    session.add(IamPrincipalOrg(principal_id=principal_id, org_id=org.id, membership_type="COLLABORATION"))
    principal.authorization_version += 1
    session.commit()
    return {"principal_id": principal_id, "org_id": org.id, "membership_type": "COLLABORATION"}


@router.get("/api/v1/principals/{principal_id}/organizations")
async def principal_organizations(
    principal_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, principal_id)
    if principal is None:
        raise ApiError(404, "PRINCIPAL_NOT_FOUND", "Principal not found")
    memberships = session.scalars(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.status == "ACTIVE",
        )
    ).all()
    return {
        "principal_id": principal.id,
        "primary_org_id": principal.primary_org_id,
        "collaborations": [
            {"org_id": row.org_id, "membership_type": row.membership_type}
            for row in memberships
            if row.membership_type == "COLLABORATION"
        ],
    }
