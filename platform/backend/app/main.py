from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings, get_settings
from app.database import get_session_factory
from app.errors import install_error_handlers
from app.auth.oidc import OidcClient
from app.api.auth import router as auth_router
from app.api.enrollment import router as enrollment_router
from app.api.core import router as core_router
from app.api.packages import router as packages_router
from app.api.roles import router as roles_router
from app.models import AuditEvent


def create_app(settings: Settings | None = None, audit_session_factory=None) -> FastAPI:
    application_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        application_settings.package_storage_path.mkdir(parents=True, exist_ok=True)
        app.state.audit_session_factory = audit_session_factory or get_session_factory(
            application_settings.database_url
        )
        yield

    app = FastAPI(title="Digital Employees Management Platform", version="0.1.0", lifespan=lifespan)
    app.state.settings = application_settings
    app.state.oidc = OidcClient(application_settings)

    @app.middleware("http")
    async def trace_id_middleware(request: Request, call_next):
        request.state.trace_id = request.headers.get("X-Trace-Id", str(uuid4()))[:64]
        response = await call_next(request)
        response.headers["X-Trace-Id"] = request.state.trace_id
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
        return response

    @app.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(core_router)
    app.include_router(packages_router)
    app.include_router(roles_router)
    app.include_router(enrollment_router)

    install_error_handlers(app)
    return app


app = create_app()
