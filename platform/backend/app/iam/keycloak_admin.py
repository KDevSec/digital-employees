from urllib.parse import urlparse

import asyncio
import time
import httpx


class KeycloakAdminClient:
    def __init__(self, issuer: str, internal_issuer: str, client_id: str, client_secret: str) -> None:
        self.issuer = issuer.rstrip("/")
        self.internal_issuer = internal_issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.realm = self.issuer.rsplit("/", 1)[-1]
        self.admin_root = self.internal_issuer.split("/realms/", 1)[0]
        self._token_value: str | None = None
        self._token_expires_at: float = 0.0
        self._token_lock = asyncio.Lock()

    async def _token(self) -> str:
        if self._token_value and time.monotonic() < self._token_expires_at:
            return self._token_value
        async with self._token_lock:
            if self._token_value and time.monotonic() < self._token_expires_at:
                return self._token_value
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
            payload = response.json()
            self._token_value = payload["access_token"]
            # Refresh 60s before actual expiry to avoid edge races.
            self._token_expires_at = time.monotonic() + max(payload.get("expires_in", 60) - 60, 10)
            return self._token_value

    async def list_user_groups_batch(self, user_ids: list[str], *, concurrency: int = 10) -> dict[str, list[dict]]:
        """Fetch group memberships for many users concurrently (bounded concurrency)."""
        if not user_ids:
            return {}
        token = await self._token()
        headers = {"Authorization": f"Bearer {token}"}
        semaphore = asyncio.Semaphore(concurrency)
        results: dict[str, list[dict]] = {}

        async def fetch_one(uid: str, client: httpx.AsyncClient) -> None:
            async with semaphore:
                url = f"{self.admin_root}/admin/realms/{self.realm}/users/{uid}/groups"
                first = 0
                collected: list[dict] = []
                while True:
                    response = await client.get(
                        url,
                        params={"first": first, "max": 100, "briefRepresentation": "false"},
                        headers=headers,
                    )
                    if response.status_code != 200:
                        results[uid] = []
                        return
                    batch = response.json()
                    collected.extend(batch)
                    if len(batch) < 100:
                        results[uid] = collected
                        return
                    first += len(batch)

        async with httpx.AsyncClient(timeout=15) as client:
            await asyncio.gather(*(fetch_one(uid, client) for uid in user_ids))
        return results

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

    async def update_user_enabled(self, user_id: str, enabled: bool) -> None:
        token = await self._token()
        url = f"{self.admin_root}/admin/realms/{self.realm}/users/{user_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.put(url, json={"enabled": enabled}, headers={"Authorization": f"Bearer {token}"})
        response.raise_for_status()

    async def list_groups(self) -> list[dict]:
        try:
            return await self._list_groups()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Keycloak Admin API error (HTTP {e.response.status_code}): {e.response.text[:200]}") from e
        except httpx.RequestError as e:
            raise RuntimeError(f"Keycloak connection failed: {e}") from e

    async def _list_groups(self) -> list[dict]:
        token = await self._token()
        headers = {"Authorization": f"Bearer {token}"}
        base = f"{self.admin_root}/admin/realms/{self.realm}"
        async with httpx.AsyncClient(timeout=30) as client:
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

    async def list_user_groups(self, user_id: str) -> list[dict]:
        """Return the groups a user is a direct member of (id/name/attributes)."""
        token = await self._token()
        headers = {"Authorization": f"Bearer {token}"}
        url = f"{self.admin_root}/admin/realms/{self.realm}/users/{user_id}/groups"
        async with httpx.AsyncClient(timeout=15) as client:
            first = 0
            result: list[dict] = []
            while True:
                response = await client.get(
                    url,
                    params={"first": first, "max": 100, "briefRepresentation": "false"},
                    headers=headers,
                )
                response.raise_for_status()
                batch = response.json()
                result.extend(batch)
                if len(batch) < 100:
                    return result
                first += len(batch)
