from collections.abc import Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import AuthenticatedPrincipal
from app.config import Settings
from app.database import Base, get_session
from app.domain.authorization import RoleCode, ScopeType
from app.main import create_app
from app.models import IamDepartment, IamDomain, IamPrincipal, RoleAssignment


@pytest.fixture
def db_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory.begin() as session:
        domain = IamDomain(id="domain-a", name="Example Corp", status="ACTIVE")
        department = IamDepartment(id="dept-a", domain_id=domain.id, name="Engineering", status="ACTIVE")
        session.add_all(
            [
                domain,
                department,
                IamPrincipal(
                    id="system-user",
                    issuer="https://iam.test/realms/digital",
                    subject="sub-system",
                    username="system",
                    display_name="System Admin",
                    domain_id=domain.id,
                    department_id=department.id,
                    status="ACTIVE",
                ),
                IamPrincipal(
                    id="employee-user",
                    issuer="https://iam.test/realms/digital",
                    subject="sub-employee",
                    username="employee",
                    display_name="Employee",
                    domain_id=domain.id,
                    department_id=department.id,
                    status="ACTIVE",
                ),
                RoleAssignment(
                    id="role-system",
                    principal_id="system-user",
                    role_code=RoleCode.SYSTEM_ADMIN,
                    scope_type=ScopeType.GLOBAL,
                    status="ACTIVE",
                    created_by="bootstrap",
                ),
                RoleAssignment(
                    id="role-employee",
                    principal_id="employee-user",
                    role_code=RoleCode.EMPLOYEE,
                    scope_type=ScopeType.SELF,
                    status="ACTIVE",
                    created_by="bootstrap",
                ),
            ]
        )
    return factory


@pytest_asyncio.fixture
async def client(db_factory: sessionmaker[Session], tmp_path: Path):
    settings = Settings(
        database_url="sqlite+pysqlite://",
        package_storage_path=tmp_path / "packages",
        platform_base_url="http://localhost:18000",
        oidc_issuer="https://iam.test/realms/digital",
        oidc_client_id="platform-web",
        oidc_client_secret="test-secret",
        session_secret="test-session-secret-with-at-least-32-characters",
        machine_signing_secret="test-machine-secret-with-at-least-32-characters",
        testing=True,
    )
    app = create_app(settings, audit_session_factory=db_factory)

    async def session_override():
        with db_factory() as session:
            yield session

    def identity_override(request: Request) -> AuthenticatedPrincipal:
        token = request.headers.get("Authorization", "").removeprefix("Bearer ")
        principal_id = {"test-system": "system-user", "test-employee": "employee-user"}.get(token)
        if not principal_id:
            from app.errors import ApiError

            raise ApiError(401, "PERSON_SESSION_INVALID", "Authentication required")
        with db_factory() as session:
            return AuthenticatedPrincipal.load(session, principal_id)

    app.dependency_overrides[get_session] = session_override
    app.state.identity_override = identity_override
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as test_client:
            yield test_client


@pytest.fixture
def system_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-system"}


@pytest.fixture
def employee_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-employee"}
