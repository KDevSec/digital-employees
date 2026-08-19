from datetime import UTC, datetime
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import (
    AuthenticatedPrincipal,
    get_current_principal,
    require_organization_permission,
    require_permission,
)
from app.domain.authorization import ROLE_PERMISSIONS
from app.domain.scoped_authorization import is_scoped_allowed
from app.database import get_session
from app.audit import record_audit
from app.errors import ApiError
from app.iam.sync import rebuild_domain_closure, reconcile_organization_snapshot
from app.models import (
    BffSession,
    IamDepartment,
    IamDomain,
    IamOrgClosure,
    IamOrgNode,
    IamPrincipal,
    IamPrincipalOrg,
    IamSyncOperation,
    IamTeam,
    RoleAssignment,
    ScopedRoleAssignment,
)

logger = logging.getLogger("platform.organizations")


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


class OrganizationArchive(BaseModel):
    version: int = Field(ge=1)


class PrincipalStatusChange(BaseModel):
    status: str = Field(pattern=r"^(ACTIVE|DISABLED)$")


class BatchStatusChange(BaseModel):
    principal_ids: list[str] = Field(min_length=1, max_length=200)
    status: str = Field(pattern=r"^(ACTIVE|DISABLED)$")


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


@router.post("/api/v1/org-nodes", status_code=status.HTTP_201_CREATED)
# Deprecated: organization structure is maintained in Keycloak, not via this API.
async def create_organization(
    body: OrganizationCreate,
    request: Request,
    idempotency_key: str = Header(min_length=1, max_length=200, alias="Idempotency-Key"),
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    payload = body.model_dump()
    existing_operation = session.get(IamSyncOperation, idempotency_key)
    if existing_operation is not None:
        if existing_operation.payload != payload:
            raise ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key was already used with another payload")
        node = session.get(IamOrgNode, existing_operation.payload.get("node_id", ""))
        if node is None:
            raise ApiError(409, "SYNC_OPERATION_PENDING", "The original operation has not completed")
        return org_json(node)
    operation = IamSyncOperation(
        id=idempotency_key,
        idempotency_key=idempotency_key,
        operation_type="ORG_NODE_CREATE",
        payload=payload,
        status="PENDING",
    )
    session.add(operation)
    session.flush()
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
    operation.payload = {**operation.payload, "node_id": node.id}
    operation.status = "COMPLETED"
    operation.updated_at = datetime.now(UTC)
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
    if not request.app.state.settings.testing:
        legacy = session.scalar(
            select(IamOrgNode.id).where(IamOrgNode.keycloak_group_id.like("legacy-%")).limit(1)
        )
        if legacy is not None:
            await reconcile_organization_snapshot(request.app.state.iam_admin, session)
    statement = select(IamOrgNode).where(IamOrgNode.parent_id == parent_id).order_by(
        IamOrgNode.sort_order, IamOrgNode.name
    )
    rows = session.scalars(statement.limit(limit)).all()
    fixed_role_allowed = any(
        "role.manage" in ROLE_PERMISSIONS[assignment.role]
        for assignment in identity.authorization.assignments
    )
    has_scoped_permission = any(
        "organization.read" in grant.permissions
        for grant in identity.authorization.scoped_grants
    )
    if not fixed_role_allowed and not has_scoped_permission:
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
    return [
        org_json(row)
        for row in rows
        if fixed_role_allowed
        or is_scoped_allowed(session, identity.authorization.scoped_grants, "organization.read", row.id)
    ]


@router.post("/api/v1/iam/reconcile-organizations")
async def reconcile_organizations(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    count = await reconcile_organization_snapshot(request.app.state.iam_admin, session)
    logger.info("iam organizations reconciled", extra={"trace_id": request.state.trace_id, "actor_id": identity.principal.id, "synchronized": count})
    return {"synchronized": count, "status": "SYNCED"}


@router.patch("/api/v1/org-nodes/{org_id}")
# Deprecated: organization structure is maintained in Keycloak, not via this API.
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
# Deprecated: organization structure is maintained in Keycloak, not via this API.
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
    node = session.get(IamOrgNode, org_id)
    if node is None:
        raise ApiError(404, "ORG_NOT_FOUND", "Organization not found")
    require_organization_permission(session, identity, "organization.read", node.id)
    edges = session.scalars(
        select(IamOrgClosure)
        .where(IamOrgClosure.descendant_id == org_id, IamOrgClosure.depth > 0)
        .order_by(IamOrgClosure.depth.desc())
    ).all()
    result = org_json(node)
    result["ancestors"] = [edge.ancestor_id for edge in edges]
    return result


@router.post("/api/v1/org-nodes/{org_id}/archive")
# Deprecated: organization structure is maintained in Keycloak, not via this API.
async def archive_organization(
    org_id: str,
    body: OrganizationArchive,
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
    if node.status == "ARCHIVED":
        return org_json(node)
    blockers: list[str] = []
    if session.scalar(select(IamOrgNode.id).where(IamOrgNode.parent_id == node.id, IamOrgNode.status == "ACTIVE").limit(1)):
        blockers.append("children")
    if session.scalar(select(IamPrincipalOrg.id).where(IamPrincipalOrg.org_id == node.id, IamPrincipalOrg.status == "ACTIVE").limit(1)):
        blockers.append("memberships")
    if session.scalar(select(ScopedRoleAssignment.id).where(ScopedRoleAssignment.scope_org_id == node.id, ScopedRoleAssignment.status == "ACTIVE").limit(1)):
        blockers.append("assignments")
    if blockers:
        raise ApiError(409, "ORG_ARCHIVE_BLOCKED", "Organization still has active dependencies", {"blockers": blockers})
    if not request.app.state.settings.testing:
        node.status = "ARCHIVED"
        await request.app.state.iam_admin.update_group(node.keycloak_group_id, keycloak_group_payload(node))
    node.status = "ARCHIVED"
    node.version += 1
    record_audit(
        session,
        request,
        event_type="ORG_ARCHIVED",
        category="ORGANIZATION",
        actor_type="PRINCIPAL",
        actor_id=identity.principal.id,
        target_type="ORG_NODE",
        target_id=node.id,
        domain_id=node.domain_id,
        department_id=None,
        summary=f"Archived organization {node.org_code}",
    )
    session.commit()
    return org_json(node)


@router.post("/api/v1/org-nodes/{org_id}/restore")
# Deprecated: organization structure is maintained in Keycloak, not via this API.
async def restore_organization(
    org_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    node = session.get(IamOrgNode, org_id)
    if node is None:
        raise ApiError(404, "ORG_NOT_FOUND", "Organization not found")
    if node.parent_id is not None:
        parent = session.get(IamOrgNode, node.parent_id)
        if parent is not None and parent.status != "ACTIVE":
            raise ApiError(409, "ORG_PARENT_INACTIVE", "Active parent organization is required")
    node.status = "ACTIVE"
    node.version += 1
    if not request.app.state.settings.testing:
        await request.app.state.iam_admin.update_group(node.keycloak_group_id, keycloak_group_payload(node))
    record_audit(
        session,
        request,
        event_type="ORG_RESTORED",
        category="ORGANIZATION",
        actor_type="PRINCIPAL",
        actor_id=identity.principal.id,
        target_type="ORG_NODE",
        target_id=node.id,
        domain_id=node.domain_id,
        department_id=None,
        summary=f"Restored organization {node.org_code}",
    )
    session.commit()
    return org_json(node)


@router.patch("/api/v1/principals/{principal_id}/status")
async def change_principal_status(
    principal_id: str,
    body: PrincipalStatusChange,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, principal_id)
    if principal is None:
        raise ApiError(404, "PRINCIPAL_NOT_FOUND", "Principal not found")
    if body.status == "DISABLED":
        active_system_admins = session.scalar(
            select(RoleAssignment.id).where(
                RoleAssignment.principal_id != principal_id,
                RoleAssignment.role_code == "SYSTEM_ADMIN",
                RoleAssignment.scope_type == "GLOBAL",
                RoleAssignment.status == "ACTIVE",
            ).limit(1)
        )
        target_is_global_admin = session.scalar(
            select(RoleAssignment.id).where(
                RoleAssignment.principal_id == principal_id,
                RoleAssignment.role_code == "SYSTEM_ADMIN",
                RoleAssignment.scope_type == "GLOBAL",
                RoleAssignment.status == "ACTIVE",
            ).limit(1)
        )
        if target_is_global_admin is not None and active_system_admins is None:
            raise ApiError(409, "LAST_SYSTEM_ADMIN", "At least one active global system administrator is required")
        if not request.app.state.settings.testing:
            if not principal.keycloak_user_id:
                raise ApiError(409, "KEYCLOAK_USER_ID_MISSING", "Principal has not been synchronized from Keycloak")
            await request.app.state.iam_admin.update_user_enabled(principal.keycloak_user_id, False)
        session.execute(delete(BffSession).where(BffSession.principal_id == principal_id))
    elif not request.app.state.settings.testing and principal.keycloak_user_id:
        await request.app.state.iam_admin.update_user_enabled(principal.keycloak_user_id, True)
    principal.status = body.status
    principal.authorization_version += 1
    record_audit(
        session,
        request,
        event_type="PRINCIPAL_STATUS_CHANGED",
        category="IDENTITY",
        actor_type="PRINCIPAL",
        actor_id=identity.principal.id,
        target_type="PRINCIPAL",
        target_id=principal.id,
        domain_id=principal.domain_id,
        department_id=principal.department_id,
        summary=f"Changed principal status to {body.status}",
    )
    session.commit()
    return {"principal_id": principal.id, "status": principal.status}


@router.post("/api/v1/principals/batch-status")
async def batch_change_principal_status(
    body: BatchStatusChange,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    failed: list[dict] = []
    for principal_id in body.principal_ids:
        principal = session.get(IamPrincipal, principal_id)
        if principal is None:
            failed.append({"id": principal_id, "reason": "Principal not found"})
            continue
        if body.status == "DISABLED":
            active_system_admins = session.scalar(
                select(RoleAssignment.id).where(
                    RoleAssignment.principal_id != principal_id,
                    RoleAssignment.role_code == "SYSTEM_ADMIN",
                    RoleAssignment.scope_type == "GLOBAL",
                    RoleAssignment.status == "ACTIVE",
                ).limit(1)
            )
            target_is_global_admin = session.scalar(
                select(RoleAssignment.id).where(
                    RoleAssignment.principal_id == principal_id,
                    RoleAssignment.role_code == "SYSTEM_ADMIN",
                    RoleAssignment.scope_type == "GLOBAL",
                    RoleAssignment.status == "ACTIVE",
                ).limit(1)
            )
            if target_is_global_admin is not None and active_system_admins is None:
                failed.append({"id": principal_id, "reason": "Last global system admin cannot be disabled"})
                continue
            if not request.app.state.settings.testing:
                if not principal.keycloak_user_id:
                    failed.append({"id": principal_id, "reason": "Not synchronized from Keycloak"})
                    continue
                await request.app.state.iam_admin.update_user_enabled(principal.keycloak_user_id, False)
            session.execute(delete(BffSession).where(BffSession.principal_id == principal_id))
        elif not request.app.state.settings.testing and principal.keycloak_user_id:
            await request.app.state.iam_admin.update_user_enabled(principal.keycloak_user_id, True)
        principal.status = body.status
        principal.authorization_version += 1
        record_audit(
            session,
            request,
            event_type="PRINCIPAL_STATUS_CHANGED",
            category="IDENTITY",
            actor_type="PRINCIPAL",
            actor_id=identity.principal.id,
            target_type="PRINCIPAL",
            target_id=principal.id,
            domain_id=principal.domain_id,
            department_id=principal.department_id,
            summary=f"Batch: changed principal status to {body.status}",
        )
    session.commit()
    return {
        "total": len(body.principal_ids),
        "succeeded": len(body.principal_ids) - len(failed),
        "failed": failed,
    }


def _active_membership(session: Session, principal_id: str, membership_type: str) -> IamPrincipalOrg | None:
    return session.scalar(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.membership_type == membership_type,
            IamPrincipalOrg.status == "ACTIVE",
        )
    )


@router.put("/api/v1/principals/{principal_id}/primary-org")
# Deprecated: user-organization membership is maintained in Keycloak, not via this API.
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
# Deprecated: user-organization membership is maintained in Keycloak, not via this API.
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


@router.delete(
    "/api/v1/principals/{principal_id}/collaborations/{org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
# Deprecated: user-organization membership is maintained in Keycloak, not via this API.
async def remove_collaboration(
    principal_id: str,
    org_id: str,
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> None:
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, principal_id)
    if principal is None:
        raise ApiError(404, "PRINCIPAL_NOT_FOUND", "Principal not found")
    membership = session.scalar(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.org_id == org_id,
            IamPrincipalOrg.membership_type == "COLLABORATION",
            IamPrincipalOrg.status == "ACTIVE",
        )
    )
    if membership is not None:
        if not request.app.state.settings.testing:
            if not principal.keycloak_user_id:
                raise ApiError(409, "KEYCLOAK_USER_ID_MISSING", "Principal has not been synchronized from Keycloak")
            org = session.get(IamOrgNode, org_id)
            await request.app.state.iam_admin.remove_user_from_group(
                principal.keycloak_user_id, org.keycloak_group_id
            )
        membership.status = "INACTIVE"
        principal.authorization_version += 1
        record_audit(
            session,
            request,
            event_type="PRINCIPAL_COLLABORATION_REMOVED",
            category="IDENTITY",
            actor_type="PRINCIPAL",
            actor_id=identity.principal.id,
            target_type="PRINCIPAL_ORG",
            target_id=membership.id,
            domain_id=principal.domain_id,
            department_id=principal.department_id,
            summary=f"Removed collaboration organization {org_id}",
        )
        session.commit()


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



@router.get("/api/v1/principals/{principal_id}/org-context")
async def principal_org_context(
    principal_id: str,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> dict:
    require_permission(identity, "role.manage")
    principal = session.get(IamPrincipal, principal_id)
    if principal is None:
        raise ApiError(404, "PRINCIPAL_NOT_FOUND", "Principal not found")
    domain = session.get(IamDomain, principal.domain_id)
    department = session.get(IamDepartment, principal.department_id) if principal.department_id else None
    team = session.get(IamTeam, principal.team_id) if principal.team_id else None
    primary_org = (
        session.get(IamOrgNode, principal.primary_org_id) if principal.primary_org_id else None
    )
    primary_org_path: list[dict] = []
    if primary_org is not None:
        rows = session.execute(
            select(IamOrgClosure, IamOrgNode)
            .join(IamOrgNode, IamOrgNode.id == IamOrgClosure.ancestor_id)
            .where(IamOrgClosure.descendant_id == primary_org.id)
            .order_by(IamOrgClosure.depth.desc())
        ).all()
        primary_org_path = [
            {"id": node.id, "name": node.name, "org_type": node.org_type}
            for _closure, node in rows
        ]
    collaboration_rows = session.execute(
        select(IamPrincipalOrg, IamOrgNode)
        .join(IamOrgNode, IamOrgNode.id == IamPrincipalOrg.org_id)
        .where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.status == "ACTIVE",
            IamPrincipalOrg.membership_type == "COLLABORATION",
        )
    ).all()
    return {
        "principal_id": principal.id,
        "domain": {"id": domain.id, "name": domain.name} if domain else None,
        "department": {"id": department.id, "name": department.name} if department else None,
        "team": {"id": team.id, "name": team.name} if team else None,
        "primary_org": {"id": primary_org.id, "name": primary_org.name} if primary_org else None,
        "primary_org_path": primary_org_path,
        "collaborations": [
            {"org_id": org.id, "name": org.name, "membership_type": membership.membership_type}
            for membership, org in collaboration_rows
        ],
    }
