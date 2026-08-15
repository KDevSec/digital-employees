from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_session
from app.domain.authorization import (
    AuthorizationContext,
    DataScope,
    RoleAssignment as DomainRoleAssignment,
    ROLE_PERMISSIONS,
    RoleCode,
    ScopeType,
)
from app.errors import ApiError
from app.auth.sessions import session_token_hash
from app.models import BffSession, IamPrincipal, RoleAssignment


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    principal: IamPrincipal
    authorization: AuthorizationContext

    @classmethod
    def load(cls, session: Session, principal_id: str) -> "AuthenticatedPrincipal":
        principal = session.get(IamPrincipal, principal_id)
        if principal is None or principal.status != "ACTIVE":
            raise ApiError(401, "PERSON_SESSION_INVALID", "Authentication required")
        rows = session.scalars(
            select(RoleAssignment).where(
                RoleAssignment.principal_id == principal_id,
                RoleAssignment.status == "ACTIVE",
            )
        ).all()
        assignments = tuple(
            DomainRoleAssignment(
                RoleCode(row.role_code),
                DataScope(
                    ScopeType(row.scope_type),
                    row.domain_id,
                    frozenset(item.department_id for item in row.departments),
                ),
            )
            for row in rows
        )
        return cls(principal, AuthorizationContext(principal.id, assignments))


async def get_current_principal(
    request: Request,
    session: Session = Depends(get_session),
) -> AuthenticatedPrincipal:
    override = getattr(request.app.state, "identity_override", None)
    if override is not None:
        identity = override(request)
        request.state.authenticated_identity = identity
        return identity
    raw_session = request.cookies.get("platform_session")
    if raw_session:
        stored = session.get(BffSession, session_token_hash(raw_session))
        if stored is not None:
            expires_at = stored.expires_at.replace(tzinfo=UTC) if stored.expires_at.tzinfo is None else stored.expires_at
            if expires_at > datetime.now(UTC):
                identity = AuthenticatedPrincipal.load(session, stored.principal_id)
                request.state.authenticated_identity = identity
                return identity
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        claims = await request.app.state.oidc.validate_token(authorization.removeprefix("Bearer "))
        principal = request.app.state.oidc.sync_principal(session, claims, request.app.state.settings)
        session.commit()
        identity = AuthenticatedPrincipal.load(session, principal.id)
        request.state.authenticated_identity = identity
        return identity
    raise ApiError(401, "PERSON_SESSION_INVALID", "Authentication required")


def require_permission(identity: AuthenticatedPrincipal, permission: str) -> None:
    if not any(
        permission in ROLE_PERMISSIONS[assignment.role]
        for assignment in identity.authorization.assignments
    ):
        raise ApiError(403, "PERMISSION_DENIED", "You do not have permission for this operation")
