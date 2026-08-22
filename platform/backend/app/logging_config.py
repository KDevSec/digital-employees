import gzip
import json
import logging
import os
import re
import shutil
import time
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

_MB = 1024 * 1024
_FILE_HANDLER_ATTR = "_platform_file_handler"
_LOG_FILE_NAME = "platform.log"
_BACKUP_GLOB = f"{_LOG_FILE_NAME}.*"


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
    return SENSITIVE_KEYS.sub("***", value)


class DailyAndSizeRotatingFileHandler(TimedRotatingFileHandler):
    """按天（午夜）或单文件 ≥ maxBytes 时轮转；备份可 gzip 压缩；backupCount 之外删除。

    重写 shouldRollover 叠加大小判断；重写 doRollover 使同日多次（大小触发）轮转
    生成唯一备份名 `platform.log.YYYY-MM-DD[.N][.gz]`，避免覆盖。
    """

    def __init__(self, filename, maxBytes: int = 0, backupCount: int = 7, compress: bool = False, **kwargs):
        super().__init__(filename, when="midnight", backupCount=backupCount, **kwargs)
        self.maxBytes = maxBytes
        self.compress = compress

    def shouldRollover(self, record: logging.LogRecord) -> int:
        if self.stream is None:
            self.stream = self._open()
        if self.maxBytes > 0:
            self.stream.seek(0, os.SEEK_END)
            if self.stream.tell() >= self.maxBytes:
                return 1
        if time.time() >= self.rolloverAt:
            return 1
        return 0

    def doRollover(self) -> None:
        if self.stream:
            self.stream.close()
            self.stream = None
        base = self.baseFilename
        date = time.strftime(self.suffix, time.localtime(time.time()))
        dfn = f"{base}.{date}"
        if os.path.exists(dfn) or (self.compress and os.path.exists(f"{dfn}.gz")):
            index = 1
            candidate = f"{base}.{date}.{index}"
            while os.path.exists(candidate) or (self.compress and os.path.exists(f"{candidate}.gz")):
                index += 1
                candidate = f"{base}.{date}.{index}"
            dfn = candidate
        if self.compress:
            dfn = f"{dfn}.gz"
            with open(base, "rb") as source, gzip.open(dfn, "wb") as target:
                shutil.copyfileobj(source, target)
            os.remove(base)
        else:
            if os.path.exists(dfn):
                os.remove(dfn)
            os.rename(base, dfn)
        self.stream = self._open()
        self.rolloverAt = self.computeRollover(time.time())
        self._cleanup()
        logging.getLogger("platform.logging").info(
            "log rotated", extra={"reason": "size" if self.maxBytes and os.path.exists(base) else "rollover", "file": dfn}
        )

    def _cleanup(self) -> None:
        dirpath, basename = os.path.split(self.baseFilename)
        try:
            names = os.listdir(dirpath)
        except OSError:
            return
        files = [os.path.join(dirpath, n) for n in names if n.startswith(f"{basename}.")]
        files.sort(key=os.path.getmtime)
        excess = len(files) - self.backupCount
        for path in files[: max(0, excess)]:
            try:
                os.remove(path)
            except OSError:
                pass


def _build_file_handler(settings) -> DailyAndSizeRotatingFileHandler:
    log_dir = Path(settings.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = DailyAndSizeRotatingFileHandler(
        log_dir / _LOG_FILE_NAME,
        maxBytes=int(getattr(settings, "log_max_mb", 10)) * _MB,
        backupCount=int(getattr(settings, "log_retention_days", 7)),
        compress=bool(getattr(settings, "log_compress", True)),
        encoding="utf-8",
    )
    handler.setFormatter(JsonFormatter())
    handler.setLevel(logging.DEBUG)
    return handler


def setup_logging(settings) -> None:
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    for handler in list(root.handlers):
        if getattr(handler, _FILE_HANDLER_ATTR, False):
            root.removeHandler(handler)
            handler.close()
    if not settings.testing:
        try:
            handler = _build_file_handler(settings)
            setattr(handler, _FILE_HANDLER_ATTR, True)
            root.addHandler(handler)
        except OSError:
            logging.getLogger("platform.logging").error("log dir not writable: %s", settings.log_dir)
    console = logging.StreamHandler()
    console.setFormatter(JsonFormatter())
    console.setLevel(settings.log_level.upper())
    setattr(console, _FILE_HANDLER_ATTR, True)
    root.addHandler(console)
    for noisy in ("uvicorn.access", "sqlalchemy.engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def apply_log_level(level: str) -> None:
    normalized = level.upper()
    logging.getLogger().setLevel(normalized)
    for handler in logging.getLogger().handlers:
        if getattr(handler, _FILE_HANDLER_ATTR, False) and not isinstance(handler, DailyAndSizeRotatingFileHandler):
            handler.setLevel(normalized)


def apply_log_rotation(settings) -> None:
    """按当前 settings 重建文件 handler（log_dir/max_mb/retention/compress 即时生效）。"""
    root = logging.getLogger()
    for handler in list(root.handlers):
        if isinstance(handler, DailyAndSizeRotatingFileHandler) and getattr(handler, _FILE_HANDLER_ATTR, False):
            root.removeHandler(handler)
            handler.close()
    if getattr(settings, "testing", False):
        return
    try:
        new_handler = _build_file_handler(settings)
        setattr(new_handler, _FILE_HANDLER_ATTR, True)
        root.addHandler(new_handler)
    except OSError:
        logging.getLogger("platform.logging").error("log dir not writable: %s", settings.log_dir)


def get_log_file_path(settings) -> Path:
    return Path(settings.log_dir) / _LOG_FILE_NAME


def list_backup_dates(settings) -> list[str]:
    """列出可用历史备份日期（去重倒序）。"""
    log_dir = Path(settings.log_dir)
    if not log_dir.is_dir():
        return []
    dates: set[str] = set()
    for entry in log_dir.glob(_BACKUP_GLOB):
        suffix = entry.name[len(_LOG_FILE_NAME) + 1:]
        date = suffix.split(".")[0]
        if re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            dates.add(date)
    return sorted(dates, reverse=True)


def backup_path_for_date(settings, date: str) -> Path | None:
    """返回某日期对应的备份文件路径（优先 .gz，其次未压缩）。"""
    log_dir = Path(settings.log_dir)
    base = log_dir / f"{_LOG_FILE_NAME}.{date}"
    candidates = [base.with_suffix(base.suffix + ".gz"), base] if base.suffix == "" else []
    gz = log_dir / f"{_LOG_FILE_NAME}.{date}.gz"
    plain = log_dir / f"{_LOG_FILE_NAME}.{date}"
    for path in (gz, plain):
        if path.is_file():
            return path
    return None
