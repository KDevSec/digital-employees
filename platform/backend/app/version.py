"""平台版本单一来源（025）：版本号手工维护在 platform/VERSION。

读取顺序：环境变量 PLATFORM_VERSION（CI/构建可覆盖）→ 容器内 /app/VERSION →
仓库相对路径（开发/pytest）→ 回退 0.0.0-dev。任何失败都不阻断启动。
"""
from functools import lru_cache
from pathlib import Path
import os

FALLBACK_VERSION = "0.0.0-dev"


def _candidate_paths() -> list[Path]:
    return [
        Path("/app/VERSION"),
        Path(__file__).resolve().parents[2] / "VERSION",
    ]


@lru_cache(maxsize=1)
def platform_version() -> str:
    env = os.getenv("PLATFORM_VERSION", "").strip()
    if env:
        return env
    for path in _candidate_paths():
        try:
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
        except OSError:
            continue
    return FALLBACK_VERSION
