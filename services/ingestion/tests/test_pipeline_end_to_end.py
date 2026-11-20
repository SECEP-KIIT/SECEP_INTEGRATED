"""End-to-end pipeline test across 52+ fixtures, 51MB DLQ, replay idempotency, secret leak check, and p95 latency."""
from __future__ import annotations

import json
import logging
import statistics
import tempfile
import time
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.body import build_bodies_and_urls
from ingestion.config import Config
from ingestion.logging_ import JsonFormatter
from ingestion.mime_parser import parse_mime_message
from ingestion.providers.fixtures import FixtureProvider
from ingestion.publisher import StreamPublisher
from ingestion.scheduler import IngestionScheduler
from ingestion.store import MailboxRecord, StoreResult

FIXTURES = Path(__file__).parent / "fixtures"

KNOWN_SECRETS = [
    "Sup3rS3cretPass!99",
    "sk-test-AbCdEf1234567890XyZ",
    "AKIAIOSFODNN7EXAMPLE",
    "MIIBOgIBAAJBALeFakeKeyMaterialForTestingOnly1234567890ABCDEF",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    "849201",
    "4111-1111-1111-1111",
]


class _InMemoryConn:
    def __enter__(self) -> "_InMemoryConn":
        return self

    def __exit__(self, *args: Any) -> None:
        return None

    def transaction(self) -> "_InMemoryConn":
        return self


class _InMemoryStore:
    def __init__(self, mailbox: MailboxRecord) -> None:
        self.mailbox = mailbox
        self.threads: dict[tuple[str, str], dict[str, Any]] = {}
        self.emails: dict[tuple[str, str], dict[str, Any]] = {}
        self.secrets: list[dict[str, Any]] = []
        self.checkpoint_updates = 0

    def ping(self) -> bool:
        return True

    def list_candidate_mailbox_ids(self, allow_ids: tuple[str, ...] = ()) -> list[str]:
        return [self.mailbox.id]

    def try_lock_and_get_mailbox(self, conn: Any, mailbox_id: str) -> MailboxRecord | None:
        return self.mailbox if mailbox_id == self.mailbox.id and self.mailbox.status == "active" else None

    def update_mailbox_checkpoint(self, mailbox_id: str, history_id: str | None) -> None:
        self.checkpoint_updates += 1
        if history_id:
            self.mailbox.history_id = history_id

    def upsert_sent_thread(self, **kwargs: Any) -> str:
        key = (kwargs["mailbox_id"], kwargs["provider_thread_id"])
        if key not in self.threads:
            self.threads[key] = {"id": str(uuid.uuid4()), "message_count": 0}
        return self.threads[key]["id"]

    def store_email_and_secrets(self, **kwargs: Any) -> StoreResult:
        mb: MailboxRecord = kwargs["mailbox"]
        tkey = (mb.id, kwargs["provider_thread_id"])
        if tkey not in self.threads:
            self.threads[tkey] = {"id": str(uuid.uuid4()), "message_count": 0}
        thread_id = self.threads[tkey]["id"]

        ekey = (mb.id, kwargs["message_id_hdr"])
        if ekey not in self.emails:
            email_id = str(uuid.uuid4())
            rec_iso = kwargs["received_at"].astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
            self.emails[ekey] = {
                "id": email_id,
                "thread_id": thread_id,
                "status": "ingested",
                "received_at_iso": rec_iso,
                **{k: v for k, v in kwargs.items() if k != "mailbox"},
            }
            self.threads[tkey]["message_count"] += 1
            for st in kwargs["secret_types"]:
                self.secrets.append({"email_id": email_id, "secret_type": st, "value_enc": None})
            return StoreResult(email_id=email_id, thread_id=thread_id, inserted=True, should_publish=True, received_at_iso=rec_iso)

        existing = self.emails[ekey]
        return StoreResult(
            email_id=existing["id"],
            thread_id=existing["thread_id"],
            inserted=False,
            should_publish=(existing["status"] == "ingested"),
            received_at_iso=existing["received_at_iso"],
        )


class _InMemoryRedis:
    def __init__(self) -> None:
        self.streams: dict[str, list[dict[str, str]]] = {"emails.ingested": [], "emails.dlq": []}

    def ping(self) -> bool:
        return True

    def xadd(self, name: str, fields: dict[str, str], **kwargs: Any) -> str:
        self.streams.setdefault(name, []).append(fields)
        return f"{len(self.streams[name])}-0"


class TestPipelineEndToEnd(unittest.TestCase):
    def test_52_fixtures_e2e_replay_and_no_secret_leaks(self) -> None:
        mb = MailboxRecord(
            id="00000000-0000-0000-0000-000000000001",
            tenant_id="00000000-0000-0000-0000-000000000010",
            user_id="00000000-0000-0000-0000-000000000020",
            provider="gmail",
            address="bob@corp.example",
            history_id=None,
            refresh_token_enc="unused",
            status="active",
        )
        cfg = Config(
            database_url="",
            redis_url="",
            google_client_id="",
            google_client_secret="",
            master_key_file="",
            poll_interval_s=30,
            max_raw_mb=50,
            ingest_source="fixtures",
            fixtures_dir=str(FIXTURES),
            fixture_mailbox_id=mb.id,
            mailbox_ids=(),
            health_port=8004,
            log_level="INFO",
        )
        store = _InMemoryStore(mb)
        redis_mock = _InMemoryRedis()
        publisher = StreamPublisher(redis_mock)
        provider = FixtureProvider(FIXTURES)

        log_lines: list[str] = []

        class CaptureHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                log_lines.append(JsonFormatter().format(record))

        root = logging.getLogger()
        ch = CaptureHandler()
        root.addHandler(ch)
        try:
            sched = IngestionScheduler(
                config=cfg,
                store=store,  # type: ignore[arg-type]
                publisher=publisher,
                provider=provider,
                master_key=None,
                conn_factory=lambda: _InMemoryConn(),
            )
            sched.poll_once()

            # 51 valid fixtures + 1 malformed (21_malformed_dlq.eml)
            self.assertEqual(len(store.emails), 51)
            self.assertEqual(len(redis_mock.streams["emails.ingested"]), 51)
            self.assertEqual(len(redis_mock.streams["emails.dlq"]), 1)
            dlq_evt = json.loads(redis_mock.streams["emails.dlq"][0]["data"])
            self.assertEqual(dlq_evt["stage"], "parse_error")

            # Simulate M3 having triaged all emails -> second replay adds 0 rows & 0 events
            for row in store.emails.values():
                row["status"] = "triaged"
            sched.poll_once()
            self.assertEqual(len(store.emails), 51)
            self.assertEqual(len(redis_mock.streams["emails.ingested"]), 51)

            # Assert no unmasked secret appears in any stored column, event, or log line
            all_text_blobs: list[str] = []
            for row in store.emails.values():
                all_text_blobs.append(row["body_text"])
                all_text_blobs.append(row["ml_text"])
            for evt in redis_mock.streams["emails.ingested"] + redis_mock.streams["emails.dlq"]:
                all_text_blobs.append(evt["data"])
            all_text_blobs.extend(log_lines)

            combined = "\n".join(all_text_blobs)
            for secret in KNOWN_SECRETS:
                self.assertNotIn(secret, combined)
        finally:
            root.removeHandler(ch)

    def test_51mb_message_goes_to_dlq(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            big_eml = Path(tmp) / "too_big.eml"
            header = b"Message-ID: <big@secep.example>\r\nFrom: a@b.c\r\nTo: bob@corp.example\r\nSubject: Big\r\n\r\n"
            big_eml.write_bytes(header + b"A" * (51 * 1024 * 1024))

            mb = MailboxRecord("mb-1", "ten-1", "usr-1", "gmail", "bob@corp.example", None, "unused", "active")
            cfg = Config("", "", "", "", "", 30, 50, "fixtures", tmp, mb.id, (), 8004, "INFO")
            store = _InMemoryStore(mb)
            redis_mock = _InMemoryRedis()
            sched = IngestionScheduler(
                config=cfg,
                store=store,  # type: ignore[arg-type]
                publisher=StreamPublisher(redis_mock),
                provider=FixtureProvider(tmp),
                master_key=None,
                conn_factory=lambda: _InMemoryConn(),
            )
            sched.poll_once()
            self.assertEqual(len(store.emails), 0)
            self.assertEqual(len(redis_mock.streams["emails.dlq"]), 1)
            dlq_evt = json.loads(redis_mock.streams["emails.dlq"][0]["data"])
            self.assertEqual(dlq_evt["stage"], "too_large")

    def test_50kb_message_p95_latency_under_80ms(self) -> None:
        body = ("<p>Quarterly update with password: Secret999 and link <a href='https://corp.example'>portal</a>.</p>" * 450)[:48000]
        raw = (
            "Message-ID: <perf@secep.example>\r\n"
            "From: perf@corp.example\r\nTo: bob@corp.example\r\nSubject: Perf\r\n"
            "Content-Type: text/html; charset=utf-8\r\n\r\n" + body
        ).encode("utf-8")

        timings_ms: list[float] = []
        for _ in range(25):
            t0 = time.perf_counter()
            parsed = parse_mime_message(raw, "perf-1")
            build_bodies_and_urls(parsed)
            timings_ms.append((time.perf_counter() - t0) * 1000.0)

        p95 = statistics.quantiles(timings_ms, n=20)[18]
        self.assertLessEqual(p95, 80.0, msg=f"p95 latency {p95:.2f}ms exceeded 80ms")


if __name__ == "__main__":
    unittest.main()
