from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.auth.oidc import OidcClient
from app.config import Settings
from app.database import Base
from app.models import RoleAssignment


def test_first_directory_sync_grants_employee_self_scope() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    settings = Settings(testing=True)
    with Session(engine) as session:
        principal = OidcClient.sync_principal(
            session,
            {
                "iss": settings.oidc_issuer,
                "sub": "employee-subject",
                "preferred_username": "employee",
                "domain_id": "domain-east",
                "department_id": "dept-rd",
            },
            settings,
        )
        assignment = session.scalar(select(RoleAssignment).where(RoleAssignment.principal_id == principal.id))

    assert assignment is not None
    assert assignment.role_code == "EMPLOYEE"
    assert assignment.scope_type == "SELF"
