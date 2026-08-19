class OrganizationCycleError(ValueError):
    pass


def build_closure_edges(parents: dict[str, str | None]) -> set[tuple[str, str, int]]:
    """Return (ancestor, descendant, depth) edges for a parent map."""
    edges: set[tuple[str, str, int]] = set()
    for descendant in parents:
        current: str | None = descendant
        path: set[str] = set()
        depth = 0
        while current is not None:
            if current in path:
                raise OrganizationCycleError(f"organization cycle includes {current}")
            path.add(current)
            edges.add((current, descendant, depth))
            current = parents.get(current)
            depth += 1
    return edges


def flatten_keycloak_groups(groups: list[dict]) -> list[dict]:
    """Normalize nested Keycloak groups, including the V0.1 legacy attributes."""
    if not groups:
        return []
    rows: list[dict] = []

    def first(attributes: dict, key: str) -> str | None:
        value = attributes.get(key)
        return str(value[0]) if isinstance(value, list) and value else None

    def visit(group: dict, parent_id: str | None, domain_id: str | None) -> None:
        attributes = group.get("attributes") or {}
        legacy = (
            ("domain_id", "DOMAIN"),
            ("department_id", "DEPARTMENT"),
            ("team_id", "TEAM"),
        )
        org_id = first(attributes, "org_id")
        inferred_type = "ORG_UNIT"
        if org_id is None:
            for key, org_type in legacy:
                org_id = first(attributes, key)
                if org_id:
                    inferred_type = org_type
                    break
        if org_id is None:
            org_id = str(group["id"])
        current_domain = domain_id or first(attributes, "domain_id") or org_id
        rows.append(
            {
                "id": org_id,
                "keycloak_group_id": str(group["id"]),
                "domain_id": current_domain,
                "parent_id": parent_id,
                "org_code": first(attributes, "org_code") or org_id,
                "org_type": first(attributes, "org_type") or inferred_type,
                "name": str(group.get("name") or org_id),
                "status": first(attributes, "status") or "ACTIVE",
                "sort_order": int(first(attributes, "sort_order") or 0),
            }
        )
        for child in group.get("subGroups") or []:
            visit(child, org_id, current_domain)

    for root in groups:
        visit(root, None, None)
    return rows


def descendant_org_ids(session, org_ids: set[str]) -> set[str]:
    """Return the transitive closure of org node ids (including the selected ids)."""
    if not org_ids:
        return set()
    from sqlalchemy import select

    from app.models import IamOrgClosure

    rows = session.scalars(
        select(IamOrgClosure.descendant_id).where(IamOrgClosure.ancestor_id.in_(org_ids))
    ).all()
    return set(rows) | set(org_ids)
