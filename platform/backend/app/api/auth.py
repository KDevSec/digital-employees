import logging
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, Form, Query, Request
from fastapi.responses import RedirectResponse, Response
from urllib.parse import urlencode
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal
from app.audit import record_audit
from app.auth.oidc import InvalidOidcFlow, OidcFlow, OidcFlowCodec
from app.auth.sessions import new_session_token, session_token_hash
from app.database import get_session
from app.domain.authorization import RoleCode, ScopeType
from app.errors import ApiError
from app.models import BffSession, IamPrincipal, RoleAssignment

logger = logging.getLogger("platform.auth")


router = APIRouter()
FLOW_COOKIE = "platform_oidc_flow"
SESSION_COOKIE = "platform_session"


def safe_return_to(value: str) -> str:
    return value if value.startswith("/") and not value.startswith("//") else "/"


@router.get("/auth/login")
async def login(request: Request, return_to: str = Query(default="/")) -> RedirectResponse:
    settings = request.app.state.settings
    flow = OidcFlow(
        state=secrets.token_urlsafe(24),
        nonce=secrets.token_urlsafe(24),
        code_verifier=secrets.token_urlsafe(64),
        return_to=safe_return_to(return_to),
    )
    redirect_uri = f"{settings.platform_base_url}/auth/callback"
    url = await request.app.state.oidc.authorization_url(flow, redirect_uri, settings.oidc_client_id)
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        FLOW_COOKIE,
        OidcFlowCodec(settings.session_secret).encode(flow),
        max_age=300,
        httponly=True,
        secure=settings.platform_base_url.startswith("https://"),
        samesite="lax",
        path="/auth",
    )
    return response


@router.get("/auth/callback")
async def callback(
    request: Request,
    code: str = Query(min_length=1, max_length=4096),
    state: str = Query(min_length=1, max_length=200),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    settings = request.app.state.settings
    encoded_flow = request.cookies.get(FLOW_COOKIE)
    if not encoded_flow:
        raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC login flow is missing")
    try:
        flow = OidcFlowCodec(settings.session_secret).decode(encoded_flow, max_age_seconds=300)
    except InvalidOidcFlow as exc:
        raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC login flow is invalid") from exc
    if not secrets.compare_digest(flow.state, state):
        raise ApiError(401, "PERSON_SESSION_INVALID", "OIDC state mismatch")
    redirect_uri = f"{settings.platform_base_url}/auth/callback"
    tokens = await request.app.state.oidc.exchange_code(code, redirect_uri, flow.code_verifier)
    claims = await request.app.state.oidc.validate_token(tokens.get("id_token", ""), nonce=flow.nonce)
    principal = request.app.state.oidc.sync_principal(session, claims, settings)
    if principal.username == settings.bootstrap_system_username:
        active_system_count = session.scalar(
            select(func.count()).select_from(RoleAssignment).where(
                RoleAssignment.role_code == RoleCode.SYSTEM_ADMIN,
                RoleAssignment.status == "ACTIVE",
            )
        )
        if active_system_count == 0:
            session.add(
                RoleAssignment(
                    id=str(uuid4()),
                    principal_id=principal.id,
                    role_code=RoleCode.SYSTEM_ADMIN,
                    scope_type=ScopeType.GLOBAL,
                    status="ACTIVE",
                    created_by="bootstrap",
                )
            )
    raw_session = new_session_token()
    session.add(
        BffSession(
            id_hash=session_token_hash(raw_session),
            principal_id=principal.id,
            expires_at=datetime.now(UTC) + timedelta(hours=8),
            id_token=tokens.get("id_token"),
            sid=claims.get("sid"),
        )
    )
    record_audit(
        session,
        request,
        event_type="LOGIN_SUCCEEDED",
        category="AUTH",
        actor_type="PERSON",
        actor_id=principal.id,
        target_type="BFF_SESSION",
        target_id=None,
        domain_id=principal.domain_id,
        department_id=principal.department_id,
        summary="Completed management platform OIDC login",
    )
    session.commit()
    logger.info("login succeeded", extra={"trace_id": request.state.trace_id, "actor_id": principal.id})
    response = RedirectResponse(flow.return_to, status_code=302)
    response.delete_cookie(FLOW_COOKIE, path="/auth")
    response.set_cookie(
        SESSION_COOKIE,
        raw_session,
        max_age=8 * 3600,
        httponly=True,
        secure=settings.platform_base_url.startswith("https://"),
        samesite="lax",
        path="/",
    )
    return response


@router.get("/auth/logout")
async def logout(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    raw_session = request.cookies.get(SESSION_COOKIE)
    id_token = None
    if raw_session:
        stored = session.get(BffSession, session_token_hash(raw_session))
        if stored:
            id_token = stored.id_token
            session.delete(stored)
    record_audit(
        session,
        request,
        event_type="LOGOUT_SUCCEEDED",
        category="AUTH",
        actor_type="PERSON",
        actor_id=identity.principal.id,
        target_type="BFF_SESSION",
        target_id=None,
        domain_id=identity.principal.domain_id,
        department_id=identity.principal.department_id,
        summary="Ended management platform BFF session",
    )
    session.commit()
    settings = request.app.state.settings
    discovery = await request.app.state.oidc.discovery()
    end_session_url = discovery.get("end_session_endpoint")
    if end_session_url and id_token:
        params = urlencode(
            {
                "id_token_hint": id_token,
                "post_logout_redirect_uri": f"{settings.platform_base_url}/",
            }
        )
        response = RedirectResponse(f"{end_session_url}?{params}", status_code=302)
    else:
        response = RedirectResponse("/", status_code=302)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.post("/auth/backchannel-logout")
async def backchannel_logout(
    request: Request,
    logout_token: str = Form(...),
    session: Session = Depends(get_session),
) -> Response:
    claims = await request.app.state.oidc.validate_logout_token(logout_token)
    sid = claims.get("sid")
    sub = claims.get("sub")
    if sid:
        rows = session.scalars(select(BffSession).where(BffSession.sid == sid)).all()
    elif sub:
        rows = session.scalars(
            select(BffSession)
            .join(IamPrincipal, IamPrincipal.id == BffSession.principal_id)
            .where(IamPrincipal.issuer == claims["iss"], IamPrincipal.subject == sub)
        ).all()
    else:
        rows = []
    for row in rows:
        session.delete(row)
    record_audit(
        session,
        request,
        event_type="BACKCHANNEL_LOGOUT",
        category="AUTH",
        actor_type="SYSTEM",
        actor_id="keycloak",
        target_type="BFF_SESSION",
        target_id=sid or sub,
        domain_id=None,
        department_id=None,
        summary="Revoked BFF session via OIDC back-channel logout",
    )
    session.commit()
    logger.info(
        "back-channel logout revoked sessions",
        extra={"trace_id": request.state.trace_id, "sid": sid, "sub": sub, "revoked": len(rows)},
    )
    return Response(status_code=200)
