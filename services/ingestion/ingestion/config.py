"""Environment configuration for the SECEP ingestion service (C8)."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _secret(name: str) -> str:
    """Read NAME_FILE if set (Docker secret, same convention as backend/src/config.js), else NAME inline."""
    path = os.environ.get(f"{name}_FILE", "").strip()
    if path:
        with open(path, encoding="utf-8") as fh:
            return fh.read().strip()
    return os.environ.get(name, "")


@dataclass(frozen=True, slots=True)
class Config:
    database_url: str
    redis_url: str
    google_client_id: str
    google_client_secret: str
    master_key_file: str
    poll_interval_s: int
    max_raw_mb: int
    ingest_source: str
    fixtures_dir: str
    fixture_mailbox_id: str | None
    mailbox_ids: tuple[str, ...]
    health_port: int
    log_level: str

    @property
    def max_raw_bytes(self) -> int:
        return self.max_raw_mb * 1024 * 1024

    @classmethod
    def from_env(cls) -> "Config":
        ingest_source = os.environ.get("INGEST_SOURCE", "gmail").strip().lower()
        if ingest_source not in ("gmail", "fixtures"):
            raise ValueError(f"INGEST_SOURCE must be 'gmail' or 'fixtures', got {ingest_source!r}")

        raw_allow = os.environ.get("MAILBOX_IDS", "").strip()
        mailbox_ids = tuple(x.strip() for x in raw_allow.split(",") if x.strip())

        fixture_mailbox_id = os.environ.get("FIXTURE_MAILBOX_ID", "").strip() or None

        return cls(
            database_url=os.environ.get("DATABASE_URL", "postgres://secep:secep@postgres:5432/secep"),
            redis_url=os.environ.get("REDIS_URL", "redis://redis:6379/0"),
            google_client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
            google_client_secret=_secret("GOOGLE_CLIENT_SECRET"),
            master_key_file=os.environ.get("MASTER_KEY_FILE", "/run/secrets/master_key"),
            poll_interval_s=max(1, int(os.environ.get("POLL_INTERVAL_S", "30"))),
            max_raw_mb=max(1, int(os.environ.get("MAX_RAW_MB", "50"))),
            ingest_source=ingest_source,
            fixtures_dir=os.environ.get("FIXTURES_DIR", "/fixtures"),
            fixture_mailbox_id=fixture_mailbox_id,
            mailbox_ids=mailbox_ids,
            health_port=int(os.environ.get("HEALTH_PORT", "8004")),
            log_level=os.environ.get("LOG_LEVEL", "INFO").strip().upper(),
        )
