def test_build_closure_edges_supports_arbitrary_depth() -> None:
    from app.domain.organization import build_closure_edges

    parents = {
        "iei": None,
        "software": "iei",
        "rd-1": "software",
        "cbb": "rd-1",
        "security": "cbb",
    }

    edges = build_closure_edges(parents)

    assert ("security", "security", 0) in edges
    assert ("cbb", "security", 1) in edges
    assert ("rd-1", "security", 2) in edges
    assert ("software", "security", 3) in edges
    assert ("iei", "security", 4) in edges


def test_build_closure_edges_rejects_cycles() -> None:
    from app.domain.organization import OrganizationCycleError, build_closure_edges

    try:
        build_closure_edges({"a": "b", "b": "a"})
    except OrganizationCycleError as exc:
        assert "cycle" in str(exc).lower()
    else:
        raise AssertionError("cycle must be rejected")


def test_database_allows_one_primary_and_multiple_collaboration_memberships() -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session

    from app.database import Base
    from app.models import IamOrgNode, IamPrincipal, IamPrincipalOrg

    engine = create_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                IamOrgNode(id="iei", keycloak_group_id="kc-iei", domain_id="iei", org_code="iei", org_type="DOMAIN", name="IEI"),
                IamOrgNode(id="security", keycloak_group_id="kc-security", domain_id="iei", parent_id="iei", org_code="security", org_type="GROUP", name="安全研发组"),
                IamOrgNode(id="kdevsec", keycloak_group_id="kc-kdevsec", domain_id="iei", parent_id="iei", org_code="kdevsec", org_type="GROUP", name="kdevsec组"),
                IamPrincipal(id="p1", issuer="issuer", subject="subject", username="fanyi", display_name="fanyi", domain_id="iei", status="ACTIVE"),
            ]
        )
        session.flush()
        session.add_all(
            [
                IamPrincipalOrg(principal_id="p1", org_id="security", membership_type="PRIMARY"),
                IamPrincipalOrg(principal_id="p1", org_id="kdevsec", membership_type="COLLABORATION"),
            ]
        )
        session.commit()
        session.add(IamPrincipalOrg(principal_id="p1", org_id="iei", membership_type="PRIMARY"))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
        else:
            raise AssertionError("a principal must not have two active primary organizations")


def test_flatten_keycloak_groups_supports_legacy_and_generic_attributes() -> None:
    from app.domain.organization import flatten_keycloak_groups

    groups = [
        {
            "id": "kc-domain",
            "name": "IEI",
            "attributes": {"domain_id": ["iei"]},
            "subGroups": [
                {
                    "id": "kc-dept",
                    "name": "研发部",
                    "attributes": {"department_id": ["dept-rd"]},
                    "subGroups": [
                        {
                            "id": "kc-team",
                            "name": "安全研发组",
                            "attributes": {
                                "org_id": ["security"],
                                "org_code": ["security-rd"],
                                "org_type": ["GROUP"],
                            },
                        }
                    ],
                }
            ],
        }
    ]

    rows = {item["id"]: item for item in flatten_keycloak_groups(groups)}

    assert rows["iei"]["keycloak_group_id"] == "kc-domain"
    assert rows["dept-rd"]["parent_id"] == "iei"
    assert rows["dept-rd"]["domain_id"] == "iei"
    assert rows["security"]["parent_id"] == "dept-rd"
    assert rows["security"]["org_code"] == "security-rd"
