import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.auth import oidc as oidc_module
from app.auth.oidc import OidcClient
from app.config import Settings
from app.database import Base
from app.iam.sync import reconcile_organization_snapshot
from app.models import IamDepartment, IamDomain, IamOrgNode, IamPrincipal, IamTeam


class FakeIamAdmin:
    def __init__(self, groups: list[dict]) -> None:
        self._groups = groups

    async def list_groups(self) -> list[dict]:
        return self._groups

    async def list_user_groups_batch(self, user_ids: list[str], *, concurrency: int = 10) -> dict:
        return {}


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


async def test_reconcile_soft_disables_groups_removed_from_keycloak(session: Session) -> None:
    await reconcile_organization_snapshot(FakeIamAdmin(_group_tree()), session)
    assert session.get(IamOrgNode, "team-fe").status == "ACTIVE"
    assert session.get(IamTeam, "team-fe").status == "ACTIVE"

    # The team group is deleted in Keycloak (department remains).
    dept = _group("kc-dept", "研发部", "dept-rd", "DEPARTMENT")
    domain = _group("kc-domain", "Example", "domain-a", "DOMAIN")
    domain["subGroups"] = [dept]
    await reconcile_organization_snapshot(FakeIamAdmin([domain]), session)

    assert session.get(IamOrgNode, "team-fe").status == "DISABLED"
    assert session.get(IamTeam, "team-fe").status == "DISABLED"
    assert session.get(IamDepartment, "dept-rd").status == "ACTIVE"

    # Re-added in Keycloak → reactivated on the next sync.
    await reconcile_organization_snapshot(FakeIamAdmin(_group_tree()), session)
    assert session.get(IamOrgNode, "team-fe").status == "ACTIVE"
    assert session.get(IamTeam, "team-fe").status == "ACTIVE"


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict | list) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeHttpxClient:
    """Stand-in for httpx.AsyncClient: serves discovery, token grant and the admin users listing."""

    issuer = Settings(testing=True).oidc_issuer
    users: list[dict] = []

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url: str, params: dict | None = None, headers: dict | None = None):
        if url.endswith("/.well-known/openid-configuration"):
            return _FakeResponse(200, {
                "issuer": self.issuer,
                "token_endpoint": f"{self.issuer}/protocol/openid-connect/token",
                "jwks_uri": f"{self.issuer}/protocol/openid-connect/certs",
            })
        if "/users" in url:
            first = int((params or {}).get("first", 0))
            page = self.users[first:first + 1000]
            return _FakeResponse(200, page)
        return _FakeResponse(404, {})

    async def post(self, url: str, data: dict | None = None):
        return _FakeResponse(200, {"access_token": "fake-token", "expires_in": 300})


async def test_sync_directory_soft_disables_principals_missing_from_iam(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(testing=True)
    session.add(IamDomain(id="default-domain", name="default-domain", status="ACTIVE"))
    # Principal still present in IAM.
    session.add(IamPrincipal(
        id="p-alice", issuer=settings.oidc_issuer, subject="kc-alice",
        username="alice", display_name="Alice", domain_id="default-domain",
        status="ACTIVE", keycloak_user_id="kc-alice",
    ))
    # Principal deleted in Keycloak (absent from the listing).
    session.add(IamPrincipal(
        id="p-gone", issuer=settings.oidc_issuer, subject="kc-gone",
        username="gone", display_name="Gone User", domain_id="default-domain",
        status="ACTIVE", keycloak_user_id="kc-gone",
    ))
    # Principal from a different issuer must be left untouched.
    session.add(IamPrincipal(
        id="p-other", issuer="https://other-issuer.example", subject="kc-other",
        username="other", display_name="Other Issuer", domain_id="default-domain",
        status="ACTIVE", keycloak_user_id="kc-other",
    ))
    session.commit()

    _FakeHttpxClient.issuer = settings.oidc_issuer
    _FakeHttpxClient.users = [
        {"id": "kc-alice", "username": "alice", "firstName": "Alice", "enabled": True, "attributes": {}},
        {"id": "kc-bob", "username": "bob", "firstName": "Bob", "enabled": True, "attributes": {}},
    ]
    monkeypatch.setattr(oidc_module.httpx, "AsyncClient", _FakeHttpxClient)

    oidc = OidcClient(settings, iam_admin=FakeIamAdmin([]))
    result = await oidc._sync_directory(session)

    assert result == {"principals_synced": 2, "principals_disabled": 1, "org_nodes_synced": 0}
    assert session.get(IamPrincipal, "p-alice").status == "ACTIVE"
    assert session.get(IamPrincipal, "p-gone").status == "DISABLED"
    assert session.get(IamPrincipal, "p-other").status == "ACTIVE"
    bob = session.query(IamPrincipal).filter_by(keycloak_user_id="kc-bob").one()
    assert bob.status == "ACTIVE"

    # A second sync (user still absent) must not double-count or re-enable.
    result_again = await oidc._sync_directory(session)
    assert result_again["principals_disabled"] == 0
    assert session.get(IamPrincipal, "p-gone").status == "DISABLED"
