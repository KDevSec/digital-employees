import gzip
import logging
import types

from app.config import Settings
from app.logging_config import DailyAndSizeRotatingFileHandler, _build_file_handler, backup_path_for_date, list_backup_dates
from app.api.system_logs import _tail_lines
from app.logging_config import _MB


def _logger_with(handler: logging.Handler) -> logging.Logger:
    logger = logging.getLogger(f"test.{id(handler)}")
    logger.handlers = [handler]
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    return logger


def test_config_defaults_not_hardcoded():
    s = Settings()
    assert s.log_max_mb == 10
    assert s.log_retention_days == 7
    assert s.log_compress is True


def test_handler_uses_settings_not_hardcoded(tmp_path):
    s = types.SimpleNamespace(log_dir=str(tmp_path), log_max_mb=1, log_retention_days=3, log_compress=False)
    h = _build_file_handler(s)
    assert h.maxBytes == 1 * _MB
    assert h.backupCount == 3
    assert h.compress is False
    h.close()


def test_size_rotation_creates_backup_and_reopens(tmp_path):
    log = tmp_path / "platform.log"
    h = DailyAndSizeRotatingFileHandler(str(log), maxBytes=1024, backupCount=2, compress=False)
    logger = _logger_with(h)
    for _ in range(4):
        logger.info("x" * 600)
    h.close()
    backups = list(tmp_path.glob("platform.log.*"))
    assert len(backups) >= 1
    assert log.exists()


def test_backup_count_deletes_excess(tmp_path):
    log = tmp_path / "platform.log"
    h = DailyAndSizeRotatingFileHandler(str(log), maxBytes=512, backupCount=2, compress=False)
    logger = _logger_with(h)
    for _ in range(8):
        logger.info("y" * 400)
    h.close()
    backups = list(tmp_path.glob("platform.log.*"))
    assert len(backups) <= 2


def test_compress_produces_gzip(tmp_path):
    log = tmp_path / "platform.log"
    h = DailyAndSizeRotatingFileHandler(str(log), maxBytes=512, backupCount=3, compress=True)
    logger = _logger_with(h)
    for _ in range(4):
        logger.info("z" * 400)
    h.close()
    gz = list(tmp_path.glob("platform.log.*.gz"))
    assert gz
    assert gzip.open(gz[0], "rb").read()  # readable gzip


def test_tail_lines_returns_last_lines(tmp_path):
    log = tmp_path / "platform.log"
    log.write_text("\n".join(f"line-{i}" for i in range(1000)) + "\n", encoding="utf-8")
    lines = _tail_lines(log, 5)
    assert lines[-1] == "line-999"
    assert len(lines) <= 5


def test_list_backup_dates_and_resolve(tmp_path):
    (tmp_path / "platform.log.2026-08-19.gz").write_bytes(b"")
    (tmp_path / "platform.log.2026-08-18").write_text("", encoding="utf-8")
    s = types.SimpleNamespace(log_dir=str(tmp_path))
    assert list_backup_dates(s) == ["2026-08-19", "2026-08-18"]
    assert backup_path_for_date(s, "2026-08-19").name == "platform.log.2026-08-19.gz"
    assert backup_path_for_date(s, "2026-08-18").name == "platform.log.2026-08-18"
    assert backup_path_for_date(s, "2026-08-17") is None
