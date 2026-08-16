from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    CustomRole,
    CustomRolePermission,
    IamOrgClosure,
    IamPrincipal,
    IamPrincipalOrg,
    ScopedRoleAssignment,
)


@dataclass(frozen=True)
class EffectiveGrant:
    assignment_id: str
    role_id: str
    permissions: frozenset[str]
    scope_org_id: str
    scope_include_descendants: bool


def _as_comparable(value: datetime | None, reference: datetime) -> datetime | None:
    if value is None or value.tzinfo is not None or reference.tzinfo is None:
        return value
    return value.replace(tzinfo=reference.tzinfo)


def load_effective_grants(session: Session, principal_id: str, *, now: datetime) -> tuple[EffectiveGrant, ...]:
    principal = session.get(IamPrincipal, principal_id)
    if principal is None or principal.status != "ACTIVE":
        return ()
    memberships = session.scalars(
        select(IamPrincipalOrg).where(
            IamPrincipalOrg.principal_id == principal_id,
            IamPrincipalOrg.status == "ACTIVE",
        )
    ).all()
    membership_orgs = {membership.org_id for membership in memberships}
    assignments = session.scalars(
        select(ScopedRoleAssignment).where(ScopedRoleAssignment.status == "ACTIVE")
    ).all()
    result: list[EffectiveGrant] = []
    for assignment in assignments:
        valid_from = _as_comparable(assignment.valid_from, now)
        valid_until = _as_comparable(assignment.valid_until, now)
        if valid_from is not None and valid_from > now:
            continue
        if valid_until is not None and valid_until <= now:
            continue
        subject_matches = assignment.subject_type == "PRINCIPAL" and assignment.subject_id == principal_id
        if assignment.subject_type == "ORGANIZATION":
            subject_matches = assignment.subject_id in membership_orgs
            if not subject_matches and assignment.subject_include_descendants and membership_orgs:
                subject_matches = session.scalar(
                    select(IamOrgClosure.ancestor_id).where(
                        IamOrgClosure.ancestor_id == assignment.subject_id,
                        IamOrgClosure.descendant_id.in_(membership_orgs),
                    ).limit(1)
                ) is not None
        if not subject_matches:
            continue
        role = session.get(CustomRole, assignment.role_id)
        if role is None or role.status != "ACTIVE":
            continue
        permissions = frozenset(
            session.scalars(
                select(CustomRolePermission.permission_code).where(
                    CustomRolePermission.role_id == role.id
                )
            ).all()
        )
        result.append(
            EffectiveGrant(
                assignment.id,
                role.id,
                permissions,
                assignment.scope_org_id,
                assignment.scope_include_descendants,
            )
        )
    return tuple(result)


def is_scoped_allowed(
    session: Session,
    grants: tuple[EffectiveGrant, ...],
    permission: str,
    resource_org_id: str,
) -> bool:
    for grant in grants:
        if permission not in grant.permissions:
            continue
        if grant.scope_org_id == resource_org_id:
            return True
        if grant.scope_include_descendants and session.get(
            IamOrgClosure, (grant.scope_org_id, resource_org_id)
        ) is not None:
            return True
    return False
