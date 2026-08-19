from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.auth.oidc import OidcClient
from app.config import Settings
from app.database import Base
from app.iam.sync import reconcile_organization_snapshot
from app.models import IamDepartment, IamDomain, IamOrgNode, IamTeam


class FakeIamAdmin:
    def __init__(self, groups: list[dict]) -> None:
        self._groups = groups

    async def list_groups(self) -> list[dict]:
        return self._groups


def _group(group_id: str, name: str, org_id: str, org_type: str) -> dict:
    return {
        "id": group_id,
        "name": name,
        "attributes": {
            "org_id": [org_id],
            "org_type": [org_type],
            "domain_id": ["domain-a"],
        },
        "subGroups": [],
    }


def _group_tree() -> list[dict]:
    team = _group("kc-team", "前端组", "team-fe", "TEAM")
    dept = _group("kc-dept", "研发部", "dept-rd", "DEPARTMENT")
    dept["subGroups"] = [team]
    domain = _group("kc-domain", "Example", "domain-a", "DOMAIN")
    domain["subGroups"] = [dept]
    return [domain]


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


async def test_reconcile_mirrors_org_nodes_into_domain_dept_team(session: Session) -> None:
    await reconcile_organization_snapshot(FakeIamAdmin(_group_tree()), session)

    assert session.get(IamDomain, "domain-a") is not None
    dept = session.get(IamDepartment, "dept-rd")
    assert dept is not None
    assert dept.domain_id == "domain-a"
    team = session.get(IamTeam, "team-fe")
    assert team is not None
    assert team.department_id == "dept-rd"


async def test_derive_org_from_groups_uses_membership_chain(session: Session) -> None:
    await reconcile_organization_snapshot(FakeIamAdmin(_group_tree()), session)

    group_to_org = {n.keycloak_group_id: n.id for n in session.query(IamOrgNode).all()}
    oidc = OidcClient(Settings(testing=True))

    derived = oidc._derive_org_from_groups(
        session,
        [{"id": "kc-team", "name": "前端组", "attributes": {}}],
        group_to_org,
    )

    assert derived == {
        "primary_org_id": "team-fe",
        "domain_id": "domain-a",
        "department_id": "dept-rd",
        "team_id": "team-fe",
    }


async def test_derive_org_returns_none_without_membership(session: Session) -> None:
    oidc = OidcClient(Settings(testing=True))
    assert oidc._derive_org_from_groups(session, [], {}) is None
