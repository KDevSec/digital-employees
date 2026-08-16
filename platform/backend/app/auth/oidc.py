import base64
import hashlib
import logging
import secrets
from dataclasses import asdict, dataclass
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import jwt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import ApiError
from app.domain.authorization import RoleCode, ScopeType
from app.models import IamDepartment, IamDomain, IamPrincipal, IamTeam, RoleAssignment, utc_now


logger = logging.getLogger(__name__)


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
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._discovery: dict | None = None
        self._jwks: dict | None = None

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

    async def sync_directory(self, session: Session) -> int:
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
            users_response = await client.get(
                f"{admin_root}/admin/realms/{realm_name}/users",
                params={"max": 1000},
                headers={"Authorization": f"Bearer {token}"},
            )
        if users_response.status_code != 200:
            raise ApiError(503, "IAM_SYNC_UNAVAILABLE", "IAM directory synchronization is unavailable")
        count = 0
        for raw_user in users_response.json():
            username = str(raw_user.get("username", ""))
            if username.startswith("service-account-"):
                continue
            attributes = raw_user.get("attributes") or {}

            def attribute(name: str):
                value = attributes.get(name)
                return value[0] if isinstance(value, list) and value else value

            claims = {
                "iss": self.settings.oidc_issuer,
                "sub": raw_user["id"],
                "keycloak_user_id": raw_user["id"],
                "preferred_username": username,
                "name": " ".join(
                    value for value in [raw_user.get("firstName"), raw_user.get("lastName")] if value
                ) or username,
                "email": raw_user.get("email"),
                "domain_id": attribute("domain_id"),
                "domain_name": attribute("domain_name"),
                "department_id": attribute("department_id"),
                "department_name": attribute("department_name"),
                "team_id": attribute("team_id"),
                "team_name": attribute("team_name"),
                "primary_org_id": attribute("primary_org_id"),
            }
            principal = self.sync_principal(session, claims, self.settings)
            principal.status = "ACTIVE" if raw_user.get("enabled", False) else "DISABLED"
            count += 1
        session.commit()
        return count

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
        assignment = session.query(RoleAssignment).filter_by(principal_id=principal.id, status="ACTIVE").first()
        if assignment is None:
            session.add(
                RoleAssignment(
                    id=str(uuid4()),
                    principal_id=principal.id,
                    role_code=RoleCode.EMPLOYEE,
                    scope_type=ScopeType.SELF,
                    status="ACTIVE",
                    created_by="iam-sync",
                )
            )
            session.flush()
        return principal
