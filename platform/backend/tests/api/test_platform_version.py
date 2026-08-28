"""025：平台版本单一来源——/health/live 返回 version；读取链回退。"""
from httpx import AsyncClient

from app import version as version_module


async def test_health_live_reports_version(client: AsyncClient) -> None:
    resp = await client.get("/health/live")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    # 仓库 platform/VERSION 存在（测试环境）时返回其内容
    assert isinstance(body["version"], str)
    assert body["version"]


def test_version_fallback_when_files_missing(monkeypatch) -> None:
    monkeypatch.setattr(version_module, "_candidate_paths", lambda: [])
    monkeypatch.delenv("PLATFORM_VERSION", raising=False)
    version_module.platform_version.cache_clear()
    assert version_module.platform_version() == version_module.FALLBACK_VERSION
    version_module.platform_version.cache_clear()


def test_version_env_override(monkeypatch) -> None:
    monkeypatch.setenv("PLATFORM_VERSION", "9.9.9")
    version_module.platform_version.cache_clear()
    assert version_module.platform_version() == "9.9.9"
    version_module.platform_version.cache_clear()
