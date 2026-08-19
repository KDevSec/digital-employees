import json
import logging
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.logging_config import get_log_file_path

router = APIRouter()
logger = logging.getLogger("platform.system_logs")

LEVEL_ORDER = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}


def _tail_lines(path: Path, max_lines: int) -> list[str]:
    if not path.exists() or not path.is_file():
        return []
    lines: deque[str] = deque(maxlen=max_lines)
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            lines.append(line.rstrip("\n"))
    return list(lines)


@router.get("/api/v1/system-logs")
async def list_system_logs(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    level: str | None = Query(default=None, max_length=10),
    q: str | None = Query(default=None, max_length=200),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    require_permission(identity, "system.logs.read")
    settings = request.app.state.settings
    log_path = get_log_file_path(settings)
    raw_lines = _tail_lines(log_path, max_lines=10000)
    items: list[dict] = []
    min_level = LEVEL_ORDER.get(level.upper()) if level else None
    keyword = q.lower() if q else None
    for line in raw_lines:
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            entry = {"message": line, "level": "INFO", "timestamp": None, "logger": None, "trace_id": None}
        entry_level = str(entry.get("level", "INFO")).upper()
        if min_level is not None and LEVEL_ORDER.get(entry_level, 0) < min_level:
            continue
        if keyword and keyword not in json.dumps(entry, ensure_ascii=False).lower():
            continue
        items.append(entry)
    total = len(items)
    page = items[offset : offset + limit]
    return {"items": page, "total": total, "offset": offset, "limit": limit}
