import base64
import asyncio
import hashlib
import logging
import time
import secrets
from dataclasses import asdict, dataclass
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import jwt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import ApiError
from app.domain.authorization import RoleCode, ScopeType
from app.iam.sync import reconcile_organization_snapshot
from app.models import (
    IamDepartment,
    IamDomain,
    IamOrgClosure,
    IamOrgNode,
    IamPrincipal,
    IamTeam,
    RoleAssignment,
    RoleAssignmentDepartment,
    utc_now,
)


logger = logging.getLogger(__name__)


def _builtin_role_for_username(username: str, department_id: str | None) -> tuple[RoleCode, ScopeType, list[str]]:
    if username == "system.admin":
        return RoleCode.SYSTEM_ADMIN, ScopeType.GLOBAL, []
    if username == "platform.admin":
        return RoleCode.PLATFORM_ADMIN, ScopeType.GLOBAL, []
    if username == "department.admin":
        return RoleCode.DEPARTMENT_ADMIN, ScopeType.DEPARTMENT_SET, ([department_id] if department_id else [])
    if username == "security.admin":
        return RoleCode.SECURITY_ADMIN, ScopeType.ALL_DEPARTMENTS, []
    if username == "audit.admin":
        return RoleCode.AUDIT_ADMIN, ScopeType.ALL_DEPARTMENTS, []
    return RoleCode.EMPLOYEE, ScopeType.SELF, []


class InvalidOidcFlow(ValueError):
    pass


@dataclass(frozen=True)
class OidcFlow:
    state: str
    nonce: str
    code_verifier: str
    return_to: str


class OidcFlowCodec:
    def __init__(self, secret: str) -> None:
        self.serializer = URLSafeTimedSerializer(secret, salt="platform-oidc-flow-v1")

    def encode(self, flow: OidcFlow) -> str:
        return self.serializer.dumps(asdict(flow))

    def decode(self, value: str, *, max_age_seconds: int) -> OidcFlow:
        try:
            data = self.serializer.loads(value, max_age=max_age_seconds)
            return OidcFlow(**data)
        except (BadSignature, SignatureExpired, TypeError, KeyError) as exc:
            raise InvalidOidcFlow("invalid or expired OIDC flow") from exc


class OidcClient:
    def __init__(self, settings: Settings, iam_admin=None) -> None:
        self.settings = settings
        self.iam_admin = iam_admin
        self._discovery: dict | None = None
        self._jwks: dict | None = None
        self._directory_sync_at: float = 0.0
        self._directory_sync_result: dict | None = None
        self._directory_sync_lock = asyncio.Lock()
        self._logout_jtis: dict[str, float] = {}

    def internalize(self, url: str) -> str:
        public = self.settings.oidc_issuer.rstrip("/")
        internal = self.settings.oidc_discovery_issuer
        return f"{internal}{url[len(public):]}" if url.startswith(public) else url

    async def discovery(self) -> dict:
        if self._discovery is None:
            url = f"{self.settings.oidc_discovery_issuer}/.well-known/openid-configuration"
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(url)
                response.raise_for_status()
            document = response.json()
            if document.get("issuer") != self.settings.oidc_issuer:
                raise ApiError(503, "OIDC_CONFIGURATION_INVALID", "OIDC issuer mismatch")
            self._discovery = document
        return self._discovery

    async def authorization_url(self, flow: OidcFlow, redirect_uri: str, client_id: str) -> str:
        document = await self.discovery()
        challenge = base64.urlsafe_b64encode(hashlib.sha256(flow.code_verifier.encode()).digest()).rstrip(b"=").decode()
        query = urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "openid",
                "state": flow.state,
                "nonce": flow.nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return f"{document['authorization_endpoint']}?{query}"

    async def exchange_code(self, code: str, redirect_uri: str, verifier: str) -> dict:
        document = await self.discovery()
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                self.internalize(document["token_endpoint"]),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": self.settings.oidc_client_id,
                    "client_secret": self.settings.oidc_client_secret,
                    "code_verifier": verifier,
                },
            )
        if response.status_code != 200:
            raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC authorization code was rejected")
        return response.json()

    async def jwks(self) -> dict:
        if self._jwks is None:
            document = await self.discovery()
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(self.internalize(document["jwks_uri"]))
                response.raise_for_status()
            self._jwks = response.json()
        return self._jwks

    async def validate_token(self, token: str, *, nonce: str | None = None) -> dict:
        try:
            header = jwt.get_unverified_header(token)
            jwks = await self.jwks()
            raw_key = next(key for key in jwks["keys"] if key.get("kid") == header.get("kid"))
            key = jwt.PyJWK.from_dict(raw_key).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256", "PS256"],
                audience=self.settings.oidc_client_id,
                issuer=self.settings.oidc_issuer,
                options={"require": ["iss", "sub", "aud", "iat", "exp"]},
            )
            if nonce is not None and not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
                raise jwt.InvalidTokenError("nonce mismatch")
            return claims
        except (jwt.PyJWTError, KeyError, StopIteration, ValueError, TypeError) as exc:
            self._jwks = None
            logger.warning("OIDC token validation failed: %s: %s", type(exc).__name__, exc)
            raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC token is invalid") from exc

    BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout"

    async def validate_logout_token(self, token: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
            jwks = await self.jwks()
            raw_key = next(key for key in jwks["keys"] if key.get("kid") == header.get("kid"))
            key = jwt.PyJWK.from_dict(raw_key).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256", "PS256"],
                audience=self.settings.oidc_client_id,
                issuer=self.settings.oidc_issuer,
                options={"require": ["iss", "aud", "iat", "exp"]},
            )
        except (jwt.PyJWTError, KeyError, StopIteration, ValueError, TypeError) as exc:
            self._jwks = None
            logger.warning("OIDC logout token validation failed: %s: %s", type(exc).__name__, exc)
            raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC logout token is invalid") from exc
        events = claims.get("events")
        if not isinstance(events, dict) or self.BACKCHANNEL_LOGOUT_EVENT not in events:
            raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC logout token is missing backchannel-logout event")
        if "nonce" in claims:
            raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC logout token must not contain nonce")
        if not claims.get("sub") and not claims.get("sid"):
            raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC logout token must contain sub or sid")
        jti = claims.get("jti")
        if jti:
            self._prune_logout_jtis(time.time())
            if jti in self._logout_jtis:
                raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC logout token replay detected")
            self._logout_jtis[jti] = float(claims.get("exp", 0))
        return claims

    def _prune_logout_jtis(self, now: float) -> None:
        for key in [k for k, exp in self._logout_jtis.items() if exp <= now]:
            self._logout_jtis.pop(key, None)

    async def sync_directory(self, session: Session, *, force: bool = False) -> dict:
        """Synchronize the IAM directory. Returns counts of synced/disabled principals
        and org nodes. Cached for directory_sync_ttl_seconds; force=True bypasses the
        cache (manual "sync now" button)."""
        ttl = self.settings.directory_sync_ttl_seconds
        now = time.monotonic()
        if not force and ttl > 0 and self._directory_sync_at and (now - self._directory_sync_at) < ttl:
            return self._directory_sync_result or {}
        async with self._directory_sync_lock:
            # Re-check inside the lock to avoid redundant syncs from concurrent requests.
            if not force and ttl > 0 and self._directory_sync_at and (time.monotonic() - self._directory_sync_at) < ttl:
                return self._directory_sync_result or {}
            result = await self._sync_directory(session)
            self._directory_sync_at = time.monotonic()
            self._directory_sync_result = result
            return result

    async def run_background_sync_once(self, settings: Settings) -> None:
        """Trigger one directory sync in the background; never raises."""
        from app.database import get_session_factory

        try:
            session_factory = get_session_factory(settings.database_url)
            with session_factory() as session:
                result = await self.sync_directory(session)
            logger.info("background directory sync done: %s", result)
        except Exception:
            logger.exception("background directory sync failed")

    async def run_background_sync(self, settings: Settings) -> None:
        """Periodically sync directory for the app lifetime; never raises."""
        ttl = settings.directory_sync_ttl_seconds or 60
        while True:
            await self.run_background_sync_once(settings)
            await asyncio.sleep(ttl)

    async def _sync_directory(self, session: Session) -> dict:
        # Sync the Keycloak group tree first so user org membership can be resolved
        # against IamOrgNode. Users belong to orgs via group membership, not attributes.
        org_nodes_synced = 0
        if self.iam_admin is not None:
            org_nodes_synced = await reconcile_organization_snapshot(self.iam_admin, session)
            group_to_org = {
                n.keycloak_group_id: n.id
                for n in session.scalars(
                    select(IamOrgNode).where(IamOrgNode.status == "ACTIVE")
                ).all()
            }
        else:
            group_to_org = {}
        document = await self.discovery()
        async with httpx.AsyncClient(timeout=15) as client:
            token_response = await client.post(
                self.internalize(document["token_endpoint"]),
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.settings.iam_sync_client_id,
                    "client_secret": self.settings.iam_sync_client_secret,
                },
            )
            if token_response.status_code != 200:
                raise ApiError(503, "IAM_SYNC_UNAVAILABLE", "IAM directory synchronization is unavailable")
            token = token_response.json()["access_token"]
            issuer = self.settings.oidc_discovery_issuer
            realm_name = self.settings.oidc_issuer.rstrip("/").rsplit("/", 1)[-1]
            admin_root = issuer.split("/realms/", 1)[0]
            # Paginate the full user listing: a truncated listing would make the
            # deletion reconciliation below disable users who still exist in IAM.
            page_size = 1000
            raw_users: list[dict] = []
            first = 0
            while True:
                users_response = await client.get(
                    f"{admin_root}/admin/realms/{realm_name}/users",
                    params={"first": first, "max": page_size, "briefRepresentation": "false"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                if users_response.status_code != 200:
                    raise ApiError(503, "IAM_SYNC_UNAVAILABLE", "IAM directory synchronization is unavailable")
                page = users_response.json()
                raw_users.extend(
                    u for u in page if not str(u.get("username", "")).startswith("service-account-")
                )
                if len(page) < page_size:
                    break
                first += page_size
        # Fetch all group memberships concurrently (bounded) instead of N sequential requests.
        memberships_by_user: dict[str, list[dict]] = {}
        if self.iam_admin is not None:
            user_ids = [u["id"] for u in raw_users if u.get("id")]
            memberships_by_user = await self.iam_admin.list_user_groups_batch(user_ids)
        count = 0
        synced_keycloak_ids: set[str] = set()
        for raw_user in raw_users:
            username = str(raw_user.get("username", ""))
            attributes = raw_user.get("attributes") or {}
            if raw_user.get("id"):
                synced_keycloak_ids.add(str(raw_user["id"]))

            def attribute(name: str):
                value = attributes.get(name)
                return value[0] if isinstance(value, list) and value else value

            primary_org_id = attribute("primary_org_id")
            domain_id = attribute("domain_id")
            department_id = attribute("department_id")
            team_id = attribute("team_id")
            # Derive org membership from Keycloak group memberships (authoritative).
            if self.iam_admin is not None and raw_user.get("id"):
                memberships = memberships_by_user.get(raw_user["id"], [])
                derived = self._derive_org_from_groups(session, memberships, group_to_org)
                if derived:
                    primary_org_id = derived.get("primary_org_id") or primary_org_id
                    domain_id = derived.get("domain_id") or domain_id
                    department_id = derived.get("department_id") or department_id
                    team_id = derived.get("team_id") or team_id
            # Fallback: when group membership is unavailable, use the deepest
            # explicit org attribute (team > department > domain) as primary org.
            if not primary_org_id:
                primary_org_id = team_id or department_id or primary_org_id
            claims = {
                "iss": self.settings.oidc_issuer,
                "sub": raw_user["id"],
                "keycloak_user_id": raw_user["id"],
                "preferred_username": username,
                "name": " ".join(
                    value for value in [raw_user.get("firstName"), raw_user.get("lastName")] if value
                ) or username,
                "email": raw_user.get("email"),
                "domain_id": domain_id,
                "domain_name": attribute("domain_name"),
                "department_id": department_id,
                "department_name": attribute("department_name"),
                "team_id": team_id,
                "team_name": attribute("team_name"),
                "primary_org_id": primary_org_id,
            }
            principal = self.sync_principal(session, claims, self.settings)
            principal.status = "ACTIVE" if raw_user.get("enabled", False) else "DISABLED"
            count += 1
        # Reconcile deletions: users removed in Keycloak simply disappear from the
        # listing. Soft-disable their principals rather than hard-deleting — role
        # assignments, enrollment requests, package ownership and audit events all
        # reference principal ids and must remain intact. Re-created users get fresh
        # Keycloak ids and sync back as new principals.
        principals_disabled = 0
        for principal in session.scalars(
            select(IamPrincipal).where(
                IamPrincipal.issuer == self.settings.oidc_issuer,
                IamPrincipal.status == "ACTIVE",
            )
        ).all():
            if principal.keycloak_user_id and principal.keycloak_user_id not in synced_keycloak_ids:
                principal.status = "DISABLED"
                principal.synced_at = utc_now()
                principals_disabled += 1
                logger.info(
                    "principal soft-disabled: missing from IAM listing",
                    extra={"principal_id": principal.id, "username": principal.username},
                )
        session.commit()
        return {
            "principals_synced": count,
            "principals_disabled": principals_disabled,
            "org_nodes_synced": org_nodes_synced,
        }

    def _derive_org_from_groups(
        self, session: Session, memberships: list[dict], group_to_org: dict[str, str]
    ) -> dict | None:
        """Map a user's Keycloak groups to org nodes and derive primary org + domain/dept/team."""
        org_ids = [group_to_org.get(str(group.get("id"))) for group in memberships]
        org_ids = [oid for oid in org_ids if oid]
        if not org_ids:
            return None
        # Primary org = the deepest node (most ancestors) among the user's memberships.
        depth_rows = session.execute(
            select(IamOrgClosure.descendant_id, func.count(IamOrgClosure.ancestor_id).label("depth"))
            .where(IamOrgClosure.descendant_id.in_(org_ids))
            .group_by(IamOrgClosure.descendant_id)
        ).all()
        depth_map = {str(row[0]): int(row[1]) for row in depth_rows}
        primary_org_id = max(org_ids, key=lambda oid: depth_map.get(oid, 1))
        # Ancestor chain root->...->primary (depth asc = self first, root last).
        path_rows = session.execute(
            select(IamOrgNode.id, IamOrgNode.org_type)
            .join(IamOrgClosure, IamOrgClosure.ancestor_id == IamOrgNode.id)
            .where(IamOrgClosure.descendant_id == primary_org_id)
            .order_by(IamOrgClosure.depth.asc())
        ).all()
        path = [(str(row[0]), row[1]) for row in path_rows]
        domain_id = next((nid for nid, t in path if t == "DOMAIN"), None)
        department_id = next((nid for nid, t in path if t == "DEPARTMENT"), None)
        team_id = next((nid for nid, t in path if t == "TEAM"), None)
        return {
            "primary_org_id": primary_org_id,
            "domain_id": domain_id,
            "department_id": department_id,
            "team_id": team_id,
        }

    @staticmethod
    def sync_principal(session: Session, claims: dict, settings: Settings) -> IamPrincipal:
        issuer = claims["iss"]
        subject = claims["sub"]
        domain_id = str(claims.get("domain_id") or "default-domain")
        department_id = claims.get("department_id")
        team_id = claims.get("team_id")
        keycloak_user_id = claims.get("keycloak_user_id") or subject
        domain = session.get(IamDomain, domain_id)
        if domain is None:
            session.add(IamDomain(id=domain_id, name=str(claims.get("domain_name") or domain_id), status="ACTIVE"))
            session.flush()
        if department_id and session.get(IamDepartment, str(department_id)) is None:
            session.add(
                IamDepartment(
                    id=str(department_id),
                    domain_id=domain_id,
                    name=str(claims.get("department_name") or department_id),
                    status="ACTIVE",
                )
            )
            session.flush()
        if team_id and session.get(IamTeam, str(team_id)) is None:
            if not department_id:
                raise ApiError(401, "PERSON_SESSION_INVALID", "IAM team is missing its department")
            session.add(
                IamTeam(
                    id=str(team_id),
                    department_id=str(department_id),
                    name=str(claims.get("team_name") or team_id),
                    status="ACTIVE",
                )
            )
            session.flush()
        principal = session.query(IamPrincipal).filter_by(issuer=issuer, subject=subject).one_or_none()
        if principal is None:
            principal = IamPrincipal(
                id=str(__import__("uuid").uuid4()),
                issuer=issuer,
                subject=subject,
                username=str(claims.get("preferred_username") or subject),
                display_name=str(claims.get("name") or claims.get("preferred_username") or subject),
                email=claims.get("email"),
                domain_id=domain_id,
                department_id=str(department_id) if department_id else None,
                team_id=str(team_id) if team_id else None,
                status="ACTIVE",
                keycloak_user_id=str(keycloak_user_id),
                primary_org_id=claims.get("primary_org_id"),
            )
            session.add(principal)
        else:
            principal.username = str(claims.get("preferred_username") or principal.username)
            principal.display_name = str(claims.get("name") or principal.display_name)
            principal.email = claims.get("email")
            principal.domain_id = domain_id
            principal.department_id = str(department_id) if department_id else None
            principal.team_id = str(team_id) if team_id else None
            principal.status = "ACTIVE"
            principal.keycloak_user_id = str(keycloak_user_id)
            if claims.get("primary_org_id"):
                principal.primary_org_id = str(claims["primary_org_id"])
            principal.synced_at = utc_now()
        session.flush()
        username = str(claims.get("preferred_username") or principal.username or subject)
        role_code, scope_type, department_ids = _builtin_role_for_username(
            username, principal.department_id or principal.primary_org_id
        )
        assignment = session.query(RoleAssignment).filter_by(principal_id=principal.id, status="ACTIVE").first()
        if assignment is None:
            assignment = RoleAssignment(
                id=str(uuid4()),
                principal_id=principal.id,
                role_code=role_code,
                scope_type=scope_type,
                domain_id=domain_id,
                status="ACTIVE",
                created_by="iam-sync",
            )
            session.add(assignment)
            session.flush()
        elif assignment.created_by == "iam-sync":
            assignment.role_code = role_code
            assignment.scope_type = scope_type
            assignment.domain_id = domain_id
        if assignment.created_by == "iam-sync":
            assignment.departments = [
                existing for existing in assignment.departments if existing.department_id in set(department_ids)
            ]
            existing_ids = {item.department_id for item in assignment.departments}
            for department_id_value in department_ids:
                if department_id_value not in existing_ids:
                    assignment.departments.append(
                        RoleAssignmentDepartment(
                            role_assignment_id=assignment.id, department_id=department_id_value
                        )
                    )
        return principal
