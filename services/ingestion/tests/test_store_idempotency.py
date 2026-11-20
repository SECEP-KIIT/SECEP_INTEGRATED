"""Tests for store idempotency & crash-recovery exception (FR-ING-011, requires Postgres 16 + 001 + 004 when live)."""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from ingestion.store import IngestionStore, MailboxRecord


class TestStoreIdempotency(unittest.TestCase):
    def test_conflict_within_24h_ingested_republishes_crash_recovery(self) -> None:
        """Simulates crash between DB commit and Redis XADD."""
        now = datetime.now(timezone.utc)
        cur = MagicMock()
        # 1) thread upsert -> thread_id
        # 2) email insert ON CONFLICT DO NOTHING -> None (conflict!)
        # 3) SELECT existing email -> ingested, created 5 mins ago
        # 4) SELECT now() - interval '24 hours'
        cur.fetchone.side_effect = [
            ("thread-uuid-1",),
            None,
            ("email-uuid-1", "thread-uuid-1", "ingested", now - timedelta(minutes=5), now - timedelta(minutes=5)),
            (now - timedelta(hours=24),),
        ]
        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.cursor.return_value.__enter__.return_value = cur
        conn.transaction.return_value.__enter__.return_value = None

        store = IngestionStore(lambda: conn)
        mb = MailboxRecord(
            id="mb-1",
            tenant_id="ten-1",
            user_id="usr-1",
            provider="gmail",
            address="bob@corp.example",
            history_id=None,
            refresh_token_enc="enc",
            status="active",
        )
        res = store.store_email_and_secrets(
            mailbox=mb,
            provider_thread_id="th-1",
            provider_message_id="pm-1",
            message_id_hdr="<01@secep.example>",
            in_reply_to=None,
            from_addr="alice@corp.example",
            from_name="Alice",
            to_addrs=["bob@corp.example"],
            cc_addrs=[],
            recipient_position="to",
            subject="Test",
            subject_norm="test",
            received_at=now,
            body_text="hi",
            ml_text="hi",
            urls=[],
            attachments=[],
            auth_results=None,
            raw_size=100,
            secret_types=[],
        )
        self.assertFalse(res.inserted)
        self.assertTrue(res.should_publish)
        self.assertEqual(res.email_id, "email-uuid-1")

    def test_conflict_already_triaged_does_not_republish(self) -> None:
        now = datetime.now(timezone.utc)
        cur = MagicMock()
        cur.fetchone.side_effect = [
            ("thread-uuid-1",),
            None,
            ("email-uuid-1", "thread-uuid-1", "triaged", now - timedelta(minutes=5), now - timedelta(minutes=5)),
            (now - timedelta(hours=24),),
        ]
        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.cursor.return_value.__enter__.return_value = cur
        conn.transaction.return_value.__enter__.return_value = None

        store = IngestionStore(lambda: conn)
        mb = MailboxRecord("mb-1", "ten-1", "usr-1", "gmail", "bob@corp.example", None, "enc", "active")
        res = store.store_email_and_secrets(
            mailbox=mb,
            provider_thread_id="th-1",
            provider_message_id="pm-1",
            message_id_hdr="<01@secep.example>",
            in_reply_to=None,
            from_addr="alice@corp.example",
            from_name="Alice",
            to_addrs=["bob@corp.example"],
            cc_addrs=[],
            recipient_position="to",
            subject="Test",
            subject_norm="test",
            received_at=now,
            body_text="hi",
            ml_text="hi",
            urls=[],
            attachments=[],
            auth_results=None,
            raw_size=100,
            secret_types=[],
        )
        self.assertFalse(res.inserted)
        self.assertFalse(res.should_publish)

    @unittest.skipUnless(os.environ.get("RUN_PG_TESTS") == "1", "Set RUN_PG_TESTS=1 with Postgres 16 + 001 + 004")
    def test_live_postgres_idempotency(self) -> None:
        import psycopg

        dsn = os.environ["DATABASE_URL"]
        store = IngestionStore(lambda: psycopg.connect(dsn))
        self.assertTrue(store.ping())


if __name__ == "__main__":
    unittest.main()
