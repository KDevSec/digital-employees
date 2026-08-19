from contextlib import asynccontextmanager
import time
import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.database import get_session_factory
from app.errors import install_error_handlers
from app.logging_config import setup_logging, trace_id_var
from app.auth.oidc import OidcClient
from app.api.auth import router as auth_router
from app.api.enrollment import router as enrollment_router
from app.api.core import router as core_router
from app.api.packages import router as packages_router
from app.api.roles import router as roles_router
from app.api.organizations import router as organizations_router
from app.api.custom_roles import router as custom_roles_router
from app.api.system_logs import router as system_logs_router
from app.iam import KeycloakAdminClient
from app.models import AuditEvent


def create_app(settings: Settings | None = None, audit_session_factory=None) -> FastAPI:
    application_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        setup_logging(application_settings)
        application_settings.package_storage_path.mkdir(parents=True, exist_ok=True)
        app.state.audit_session_factory = audit_session_factory or get_session_factory(
            application_settings.database_url
        )
        yield

    app = FastAPI(title="Digital Employees Management Platform", version="0.1.0", lifespan=lifespan)
    app.state.settings = application_settings
    iam_admin = KeycloakAdminClient(
        application_settings.oidc_issuer,
        application_settings.oidc_discovery_issuer,
        application_settings.iam_sync_client_id,
        application_settings.iam_sync_client_secret,
    )
    app.state.iam_admin = iam_admin
    app.state.oidc = OidcClient(application_settings, iam_admin=iam_admin)

    @app.middleware("http")
    async def trace_id_middleware(request: Request, call_next):
        trace_id = request.headers.get("X-Trace-Id", str(uuid4()))[:64]
        request.state.trace_id = trace_id
        token = trace_id_var.set(trace_id)
        start = time.perf_counter()
        logger = logging.getLogger("platform.request")
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers["X-Trace-Id"] = request.state.trace_id
        level = logging.INFO
        if response.status_code >= 500:
            level = logging.ERROR
        elif response.status_code >= 400:
            level = logging.WARNING
        logger.log(
            level,
            "%s %s -> %s",
            request.method,
            request.url.path,
            response.status_code,
            extra={
                "trace_id": trace_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        if response.status_code in {401, 403}:
            identity = getattr(request.state, "authenticated_identity", None)
            principal = identity.principal if identity is not None else None
            try:
                with request.app.state.audit_session_factory.begin() as session:
                    session.add(
                        AuditEvent(
                            id=str(uuid4()),
                            event_type="AUTHENTICATION_FAILED" if response.status_code == 401 else "AUTHORIZATION_DENIED",
                            category="AUTH" if response.status_code == 401 else "SECURITY",
                            actor_type="PERSON" if principal is not None else "ANONYMOUS",
                            actor_id=principal.id if principal is not None else None,
                            target_type="HTTP_ENDPOINT",
                            target_id=request.url.path,
                            domain_id_snapshot=principal.domain_id if principal is not None else None,
                            department_id_snapshot=principal.department_id if principal is not None else None,
                            result="FAILURE",
                            reason_code=getattr(request.state, "error_code", "REQUEST_DENIED"),
                            summary="Authentication failed" if response.status_code == 401 else "Authorization denied",
                            trace_id=request.state.trace_id,
                        )
                    )
            except SQLAlchemyError:
                pass
        trace_id_var.reset(token)
        return response

    @app.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(core_router)
    app.include_router(packages_router)
    app.include_router(roles_router)
    app.include_router(organizations_router)
    app.include_router(custom_roles_router)
    app.include_router(enrollment_router)
    app.include_router(system_logs_router)

    install_error_handlers(app)
    return app


app = create_app()
