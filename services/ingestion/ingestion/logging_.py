"""Structured JSON-lines logging with strict PII/content redaction (NFR-SEC-007)."""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from typing import Any

try:
    import orjson

    def _dumps(obj: dict[str, Any]) -> str:
        return orjson.dumps(obj).decode("utf-8")
except ImportError:
    import json

    def _dumps(obj: dict[str, Any]) -> str:
        return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


ALLOWED_FIELDS = frozenset({
    "ts",
    "level",
    "logger",
    "event",
    "mailbox_id",
    "email_id",
    "provider_message_id",
    "thread_id",
    "count",
    "counts",
    "duration_ms",
    "wait_s",
    "attempt",
    "error_class",
    "http_status",
    "stage",
    "status",
    "reason",
})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        extra_fields = getattr(record, "fields", None)
        if isinstance(extra_fields, dict):
            for k, v in extra_fields.items():
                if k in ALLOWED_FIELDS and v is not None:
                    payload[k] = v
        if record.exc_info and record.exc_info[0] is not None:
            payload["error_class"] = record.exc_info[0].__name__
        return _dumps(payload)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)
    # Silence noisy third-party loggers that might log URLs/headers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    **fields: Any,
) -> None:
    """Log an event with allow-listed structured metadata only (no body/subject/address/token/secret)."""
    safe_fields = {k: v for k, v in fields.items() if k in ALLOWED_FIELDS}
    logger.log(level, event, extra={"fields": safe_fields})
