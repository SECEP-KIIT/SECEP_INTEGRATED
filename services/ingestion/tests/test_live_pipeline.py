"""End-to-end tests against a REAL PostgreSQL 16 (001 + 004 applied) and a REAL Redis.

Mocks cannot show lock waits: the original build deadlocked on its first email (a FOR UPDATE row lock on the
mailbox blocked the foreign-key check of its own thread insert) while every mocked test passed.

Run:  RUN_LIVE_TESTS=1 DATABASE_URL=postgres://... REDIS_URL=redis://... python -m unittest tests.test_live_pipeline
Each test creates its own tenant/user/mailbox with random ids and deletes them afterwards.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from unittest import mock

LIVE = os.environ.get("RUN_LIVE_TESTS") == "1"
FIXTURES = Path(__file__).parent / "fixtures"
POLL_TIMEOUT_S = 30


@unittest.skipUnless(LIVE, "Set RUN_LIVE_TESTS=1 with DATABASE_URL (Postgres 16 + 001 + 004) and REDIS_URL")
class TestLivePipeline(unittest.TestCase):
    def setUp(self) -> None:
        import psycopg
        import redis

        from ingestion.config import Config
        from ingestion.providers.fixtures import FixtureProvider
        from ingestion.publisher import StreamPublisher
        from ingestion.scheduler import IngestionScheduler
        from ingestion.store import IngestionStore

        self.dsn = os.environ["DATABASE_URL"]
        self.redis = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
        self.tenant, self.user, self.mailbox = (str(uuid.uuid4()) for _ in range(3))
        with psycopg.connect(self.dsn) as c:
            c.execute("INSERT INTO tenants (id, name) VALUES (%s, 'live-test')", (self.tenant,))
            c.execute("INSERT INTO users (id, tenant_id, email) VALUES (%s, %s, %s)",
                      (self.user, self.tenant, f"live-{self.user[:8]}@test.example"))
            c.execute(
                "INSERT INTO mailboxes (id, tenant_id, user_id, address, refresh_token_enc) VALUES (%s,%s,%s,%s,%s)",
                (self.mailbox, self.tenant, self.user, "bob@corp.example", "A" * 44),
            )

        self.dir = Path(tempfile.mkdtemp(prefix="secep-fx-"))
        for f in FIXTURES.glob("*.eml"):
            shutil.copy(f, self.dir / f.name)
        # A secret in the SUBJECT line (must be masked like the body).
        (self.dir / "53_subject_secret.eml").write_bytes(
            b"From: it@corp.example\r\nTo: bob@corp.example\r\nSubject: Your OTP is 482913 / password: hunter2\r\n"
            b"Message-ID: <live-subject-secret@corp.example>\r\nDate: Wed, 04 Nov 2026 09:12:31 +0000\r\n\r\n"
            b"See subject.\r\n"
        )
        self.valid = len(list(self.dir.glob("*.eml"))) - 1  # 21_malformed_dlq goes to the DLQ

        cfg = Config(
            database_url=self.dsn, redis_url=os.environ["REDIS_URL"], google_client_id="", google_client_secret="",
            master_key_file="", poll_interval_s=1, max_raw_mb=50, ingest_source="fixtures",
            fixtures_dir=str(self.dir), fixture_mailbox_id=self.mailbox, mailbox_ids=(), health_port=0,
            log_level="WARNING",
        )
        self.app_name = f"secep-live-{self.mailbox[:8]}"
        connect = lambda: psycopg.connect(self.dsn, application_name=self.app_name)  # noqa: E731
        self.scheduler = IngestionScheduler(
            config=cfg, store=IngestionStore(connect), publisher=StreamPublisher(self.redis),
            provider=FixtureProvider(self.dir), master_key=None, conn_factory=connect,
        )
        self.psycopg = psycopg

    def tearDown(self) -> None:
        with self.psycopg.connect(self.dsn) as c:
            c.execute("DELETE FROM emails WHERE mailbox_id = %s", (self.mailbox,))
            c.execute("DELETE FROM threads WHERE mailbox_id = %s", (self.mailbox,))
            c.execute("DELETE FROM mailboxes WHERE id = %s", (self.mailbox,))
            c.execute("DELETE FROM users WHERE id = %s", (self.user,))
            c.execute("DELETE FROM tenants WHERE id = %s", (self.tenant,))
        shutil.rmtree(self.dir, ignore_errors=True)

    # helpers -------------------------------------------------------------------------------------------------
    def _poll(self) -> None:
        """poll_once() in a thread with a deadline, so a lock wait fails the test instead of hanging it."""
        err: list[BaseException] = []

        def run() -> None:
            try:
                self.scheduler.poll_once()
            except BaseException as e:  # noqa: BLE001
                err.append(e)

        t = threading.Thread(target=run, daemon=True)
        t.start()
        t.join(POLL_TIMEOUT_S)
        if t.is_alive():
            self.scheduler.stop()
            with self.psycopg.connect(self.dsn, autocommit=True) as c:  # free the stuck sessions for tearDown
                c.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = %s",
                          (self.app_name,))
            t.join(10)
            self.fail(f"poll_once() did not finish within {POLL_TIMEOUT_S}s (lock wait / deadlock)")
        if err:
            raise err[0]

    def _q(self, sql: str, *args):
        with self.psycopg.connect(self.dsn) as c:
            return c.execute(sql, args).fetchall()

    def _events(self, stream: str) -> list[dict]:
        import json

        out = []
        for _id, fields in self.redis.xrange(stream, "-", "+"):
            data = json.loads(fields["data"])
            if data.get("mailbox_id") == self.mailbox:
                out.append(data)
        return out

    # tests ---------------------------------------------------------------------------------------------------
    def test_first_poll_stores_everything_without_hanging(self) -> None:
        self._poll()
        (n,), = self._q("SELECT count(*) FROM emails WHERE mailbox_id = %s", self.mailbox)
        self.assertEqual(n, self.valid)
        ingested = self._events("emails.ingested")
        self.assertEqual(len(ingested), self.valid)
        self.assertTrue(all(e["received_at"].endswith("Z") for e in ingested), "envelope times must be UTC 'Z'")
        self.assertEqual([e["stage"] for e in self._events("emails.dlq")], ["parse_error"])
        (hist,), = self._q("SELECT history_id FROM mailboxes WHERE id = %s", self.mailbox)
        self.assertEqual(hist, f"fx:{self.valid + 1}")
        rows = self._q("SELECT value_enc FROM masked_secrets s JOIN emails e ON e.id = s.email_id "
                       "WHERE e.mailbox_id = %s", self.mailbox)
        self.assertGreaterEqual(len(rows), 7)
        self.assertTrue(all(v is None for (v,) in rows), "SECEP never stores a credential value (004)")

    def test_second_poll_adds_and_publishes_nothing(self) -> None:
        self._poll()
        before = (len(self._events("emails.ingested")), len(self._events("emails.dlq")))
        self._poll()
        (n,), = self._q("SELECT count(*) FROM emails WHERE mailbox_id = %s", self.mailbox)
        self.assertEqual(n, self.valid)
        self.assertEqual((len(self._events("emails.ingested")), len(self._events("emails.dlq"))), before)

    def test_subject_secrets_are_masked(self) -> None:
        self._poll()
        (subject, subject_norm), = self._q(
            "SELECT subject, subject_norm FROM emails WHERE mailbox_id = %s AND message_id_hdr = %s",
            self.mailbox, "<live-subject-secret@corp.example>")
        for s in (subject, subject_norm):
            self.assertNotIn("482913", s)
            self.assertNotIn("hunter2", s)
        self.assertIn("[MASKED:otp]", subject)
        self.assertIn("[MASKED:password]", subject)

    def test_poison_message_is_dead_lettered_and_mailbox_moves_on(self) -> None:
        import ingestion.scheduler as sched

        real = sched.build_bodies_and_urls

        def boom(parsed):
            if parsed.provider_message_id == "22_task":
                raise RuntimeError("simulated cleaning crash")
            return real(parsed)

        with mock.patch.object(sched, "build_bodies_and_urls", side_effect=boom):
            self._poll()
        (n,), = self._q("SELECT count(*) FROM emails WHERE mailbox_id = %s", self.mailbox)
        self.assertEqual(n, self.valid - 1)
        dlq = self._events("emails.dlq")
        self.assertIn("22_task", [d["provider_message_id"] for d in dlq])
        self.assertNotIn("simulated", " ".join(d["error"] for d in dlq), "no exception text in the DLQ")
        (hist,), = self._q("SELECT history_id FROM mailboxes WHERE id = %s", self.mailbox)
        self.assertEqual(hist, f"fx:{self.valid + 1}", "checkpoint must advance past the poison message")

    def test_crash_between_commit_and_publish_is_recovered(self) -> None:
        self._poll()
        # Simulate: the row was committed but XADD never happened, and the poll is re-run from an old cursor.
        email_id = self._q("SELECT id::text FROM emails WHERE mailbox_id = %s AND provider_message_id = '01_plain'",
                           self.mailbox)[0][0]
        before = [e for e in self._events("emails.ingested") if e["email_id"] == email_id]
        with self.psycopg.connect(self.dsn) as c:
            c.execute("UPDATE mailboxes SET history_id = 'fx:0' WHERE id = %s", (self.mailbox,))
        self._poll()
        after = [e for e in self._events("emails.ingested") if e["email_id"] == email_id]
        self.assertEqual(len(after), len(before) + 1, "status still 'ingested' -> envelope re-sent")
        (n,), = self._q("SELECT count(*) FROM emails WHERE mailbox_id = %s", self.mailbox)
        self.assertEqual(n, self.valid, "no duplicate rows")


if __name__ == "__main__":
    unittest.main()
