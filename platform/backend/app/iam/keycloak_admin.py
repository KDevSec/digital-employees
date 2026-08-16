from urllib.parse import urlparse

import httpx


class KeycloakAdminClient:
    def __init__(self, issuer: str, internal_issuer: str, client_id: str, client_secret: str) -> None:
        self.issuer = issuer.rstrip("/")
        self.internal_issuer = internal_issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.realm = self.issuer.rsplit("/", 1)[-1]
        self.admin_root = self.internal_issuer.split("/realms/", 1)[0]

    async def _token(self) -> str:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.internal_issuer}/protocol/openid-connect/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
            )
        response.raise_for_status()
        return response.json()["access_token"]

    async def create_group(self, parent_group_id: str | None, payload: dict) -> str:
        token = await self._token()
        suffix = f"/groups/{parent_group_id}/children" if parent_group_id else "/groups"
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.admin_root}/admin/realms/{self.realm}{suffix}",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()
        location = response.headers.get("Location", "")
        group_id = urlparse(location).path.rstrip("/").rsplit("/", 1)[-1]
        if not group_id:
            raise RuntimeError("Keycloak did not return the created group id")
        return group_id

    async def update_group(self, group_id: str, payload: dict) -> None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.put(
                f"{self.admin_root}/admin/realms/{self.realm}/groups/{group_id}",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()

    async def move_group(self, group_id: str, new_parent_group_id: str) -> None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.admin_root}/admin/realms/{self.realm}/groups/{new_parent_group_id}/children",
                json={"id": group_id},
                headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()

    async def add_user_to_group(self, user_id: str, group_id: str) -> None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.put(
                f"{self.admin_root}/admin/realms/{self.realm}/users/{user_id}/groups/{group_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()

    async def remove_user_from_group(self, user_id: str, group_id: str) -> None:
        token = await self._token()
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.delete(
                f"{self.admin_root}/admin/realms/{self.realm}/users/{user_id}/groups/{group_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()

    async def update_user_attributes(self, user_id: str, attributes: dict[str, list[str]]) -> None:
        token = await self._token()
        headers = {"Authorization": f"Bearer {token}"}
        url = f"{self.admin_root}/admin/realms/{self.realm}/users/{user_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            current = await client.get(url, headers=headers)
            current.raise_for_status()
            payload = current.json()
            payload["attributes"] = {**(payload.get("attributes") or {}), **attributes}
            response = await client.put(url, json=payload, headers=headers)
        response.raise_for_status()

    async def list_groups(self) -> list[dict]:
        token = await self._token()
        headers = {"Authorization": f"Bearer {token}"}
        base = f"{self.admin_root}/admin/realms/{self.realm}"
        async with httpx.AsyncClient(timeout=15) as client:
            async def page(url: str) -> list[dict]:
                result: list[dict] = []
                first = 0
                while True:
                    response = await client.get(
                        url,
                        params={"first": first, "max": 100, "briefRepresentation": "false", "subGroupsCount": "false"},
                        headers=headers,
                    )
                    response.raise_for_status()
                    batch = response.json()
                    result.extend(batch)
                    if len(batch) < 100:
                        return result
                    first += len(batch)

            async def populate(group: dict) -> dict:
                children = await page(f"{base}/groups/{group['id']}/children")
                group["subGroups"] = [await populate(child) for child in children]
                return group

            roots = await page(f"{base}/groups")
            return [await populate(root) for root in roots]
