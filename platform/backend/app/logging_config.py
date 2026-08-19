import json
import logging
import re
from contextvars import ContextVar
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from typing import Any

trace_id_var: ContextVar[str | None] = ContextVar("trace_id", default=None)

SENSITIVE_KEYS = re.compile(
    r"(password|passwd|secret|token|credential|authorization|cookie|api[_-]?key)",
    re.IGNORECASE,
)
MAX_MSG_LENGTH = 4000


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        trace_id = trace_id_var.get()
        if trace_id is None:
            trace_id = getattr(record, "trace_id", None)
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "trace_id": trace_id,
            "message": _redact(record.getMessage())[:MAX_MSG_LENGTH],
        }
        if record.exc_info:
            payload["exception"] = _redact(self.formatException(record.exc_info))
        for key in ("actor_id", "method", "path", "status_code", "duration_ms", "event_type"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, default=str)


def _redact(value: str) -> str:
    def replace(match: re.Match) -> str:
        return f"{match.group(0).split('=')[0]}=***"

    return SENSITIVE_KEYS.sub("***", value)


_FILE_HANDLER_ATTR = "_platform_file_handler"
_LOG_FILE_NAME = "platform.log"


def _build_file_handler(log_dir: Path) -> TimedRotatingFileHandler:
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = TimedRotatingFileHandler(
        log_dir / _LOG_FILE_NAME,
        when="midnight",
        backupCount=7,
        encoding="utf-8",
    )
    handler.setFormatter(JsonFormatter())
    handler.setLevel(logging.DEBUG)
    return handler


def setup_logging(settings) -> None:
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    for handler in list(root.handlers):
        if getattr(handler, "_platform_file_handler", False):
            root.removeHandler(handler)
            handler.close()
    if not settings.testing:
        handler = _build_file_handler(Path(settings.log_dir))
        handler._platform_file_handler = True
        root.addHandler(handler)
    console = logging.StreamHandler()
    console.setFormatter(JsonFormatter())
    console.setLevel(settings.log_level.upper())
    console._platform_file_handler = True
    root.addHandler(console)
    for noisy in ("uvicorn.access", "sqlalchemy.engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def apply_log_level(level: str) -> None:
    normalized = level.upper()
    logging.getLogger().setLevel(normalized)
    for handler in logging.getLogger().handlers:
        if getattr(handler, "_platform_file_handler", False) and not isinstance(
            handler, TimedRotatingFileHandler
        ):
            handler.setLevel(normalized)


def apply_log_dir(log_dir: Path) -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        if isinstance(handler, TimedRotatingFileHandler) and getattr(
            handler, "_platform_file_handler", False
        ):
            root.removeHandler(handler)
            handler.close()
    new_handler = _build_file_handler(Path(log_dir))
    new_handler._platform_file_handler = True
    root.addHandler(new_handler)


def get_log_file_path(settings) -> Path:
    return Path(settings.log_dir) / _LOG_FILE_NAME
