import gzip
import json
import logging
import os
from collections import deque
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request

from app.api.dependencies import AuthenticatedPrincipal, get_current_principal, require_permission
from app.logging_config import backup_path_for_date, get_log_file_path, list_backup_dates

router = APIRouter()
logger = logging.getLogger("platform.system_logs")

LEVEL_ORDER = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40}
_MAX_TAIL_LINES = 10000


def _tail_lines(path: Path, max_lines: int) -> list[str]:
    """从文件尾高效取行，不全量读入内存。"""
    if not path.exists() or not path.is_file():
        return []
    chunk = 8192
    buffer = b""
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        position = handle.tell()
        while position > 0 and buffer.count(b"\n") <= max_lines:
            size = min(chunk, position)
            position -= size
            handle.seek(position)
            buffer = handle.read(size) + buffer
    text = buffer.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return lines[-max_lines:]


def _stream_lines(path: Path, max_lines: int) -> list[str]:
    """流式读取（gzip 自动解压），保留末尾 max_lines 行，不全量入内存。"""
    if not path.exists() or not path.is_file():
        return []
    opener = gzip.open if path.suffix == ".gz" else open
    lines: deque[str] = deque(maxlen=max_lines)
    with opener(path, "rt", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            lines.append(line.rstrip("\n"))
    return list(lines)


def _raw_lines(path: Path, max_lines: int) -> list[str]:
    if not path.exists() or not path.is_file():
        return []
    if path.suffix == ".gz":
        return _stream_lines(path, max_lines)
    return _tail_lines(path, max_lines)


def _parse_entries(raw_lines: list[str], min_level: int | None, keyword: str | None) -> list[dict]:
    items: list[dict] = []
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
    return items


@router.get("/api/v1/system-logs")
async def list_system_logs(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
    level: str | None = Query(default=None, max_length=10),
    q: str | None = Query(default=None, max_length=200),
    date: str | None = Query(default=None, max_length=10),
    offset: int = Query(default=0, ge=0, le=10000),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    require_permission(identity, "system.logs.read")
    settings = request.app.state.settings
    if date:
        path = backup_path_for_date(settings, date)
    else:
        path = get_log_file_path(settings)
    raw_lines = _raw_lines(path or Path(""), _MAX_TAIL_LINES) if path else []
    min_level = LEVEL_ORDER.get(level.upper()) if level else None
    keyword = q.lower() if q else None
    items = _parse_entries(raw_lines, min_level, keyword)
    total = len(items)
    page = items[offset : offset + limit]
    return {"items": page, "total": total, "offset": offset, "limit": limit}


@router.get("/api/v1/system-logs/files")
async def list_log_files(
    request: Request,
    identity: AuthenticatedPrincipal = Depends(get_current_principal),
) -> dict:
    require_permission(identity, "system.logs.read")
    settings = request.app.state.settings
    return {"dates": list_backup_dates(settings)}
