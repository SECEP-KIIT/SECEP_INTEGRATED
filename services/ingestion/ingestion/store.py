"""PostgreSQL store using psycopg 3 transactions, locking, and idempotent upserts (C1, FR-ING-010, FR-ING-011)."""
from __future__ import annotations

import json
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

try:
    import orjson

    def _json_dumps(obj: Any) -> str:
        return orjson.dumps(obj).decode("utf-8")
except ImportError:
    def _json_dumps(obj: Any) -> str:
        return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


@dataclass(slots=True)
class MailboxRecord:
    id: str
    tenant_id: str
    user_id: str
    provider: str
    address: str
    history_id: str | None
    refresh_token_enc: str
    status: str


@dataclass(slots=True)
class StoreResult:
    email_id: str
    thread_id: str
    inserted: bool
    should_publish: bool
    received_at_iso: str


def mailbox_advisory_key(mailbox_id: str) -> int:
    """Stable signed 64-bit integer key for pg_try_advisory_lock."""
    return zlib.crc32(mailbox_id.encode("utf-8"))


class IngestionStore:
    """Encapsulates all Postgres reads/writes for M2 ingestion."""

    def __init__(self, conn_factory: Any) -> None:
        self._conn_factory = conn_factory

    def ping(self) -> bool:
        try:
            with self._conn_factory() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            return True
        except Exception:
            return False

    def list_candidate_mailbox_ids(self, allow_ids: tuple[str, ...] = ()) -> list[str]:
        with self._conn_factory() as conn:
            with conn.cursor() as cur:
                if allow_ids:
                    cur.execute(
                        "SELECT id::text FROM mailboxes WHERE status = 'active' AND id = ANY(%s::uuid[]) ORDER BY created_at",
                        (list(allow_ids),),
                    )
                else:
                    cur.execute(
                        "SELECT id::text FROM mailboxes WHERE status = 'active' ORDER BY created_at"
                    )
                return [row[0] for row in cur.fetchall()]

    def try_lock_and_get_mailbox(self, conn: Any, mailbox_id: str) -> MailboxRecord | None:
        """Acquire non-blocking row + advisory lock and re-check status == 'active'."""
        adv_key = mailbox_advisory_key(mailbox_id)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_xact_lock(%s)", (adv_key,))
            row = cur.fetchone()
            if not row or not row[0]:
                return None

            cur.execute(
                """
                SELECT id::text, tenant_id::text, user_id::text, provider, address,
                       history_id, refresh_token_enc, status
                FROM mailboxes
                WHERE id = %s::uuid
                """,
                (mailbox_id,),
            )
            r = cur.fetchone()
            if not r or r[7] != "active":
                return None
            return MailboxRecord(
                id=r[0],
                tenant_id=r[1],
                user_id=r[2],
                provider=r[3],
                address=r[4],
                history_id=r[5],
                refresh_token_enc=r[6],
                status=r[7],
            )

    def mark_mailbox_error(self, mailbox_id: str) -> None:
        with self._conn_factory() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE mailboxes SET status = 'error' WHERE id = %s::uuid",
                        (mailbox_id,),
                    )

    def update_mailbox_checkpoint(self, mailbox_id: str, history_id: str | None) -> None:
        with self._conn_factory() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE mailboxes
                        SET history_id = COALESCE(%s, history_id),
                            last_polled_at = now()
                        WHERE id = %s::uuid
                        """,
                        (history_id, mailbox_id),
                    )

    def upsert_sent_thread(
        self,
        *,
        tenant_id: str,
        mailbox_id: str,
        provider_thread_id: str,
        subject_norm: str,
        received_at: datetime,
    ) -> str:
        """Upsert thread for a SENT message: no emails row, no message_count increment."""
        with self._conn_factory() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO threads (
                            tenant_id, mailbox_id, provider_thread_id, subject_norm,
                            last_message_at, last_message_from_self, message_count
                        )
                        VALUES (%s::uuid, %s::uuid, %s, %s, %s, true, 0)
                        ON CONFLICT (mailbox_id, provider_thread_id) DO UPDATE
                        SET last_message_at = GREATEST(threads.last_message_at, EXCLUDED.last_message_at),
                            last_message_from_self = CASE
                                WHEN threads.last_message_at IS NULL
                                     OR EXCLUDED.last_message_at >= threads.last_message_at
                                THEN true
                                ELSE threads.last_message_from_self
                            END
                        RETURNING id::text
                        """,
                        (tenant_id, mailbox_id, provider_thread_id, subject_norm, received_at),
                    )
                    return str(cur.fetchone()[0])

    def store_email_and_secrets(
        self,
        *,
        mailbox: MailboxRecord,
        provider_thread_id: str,
        provider_message_id: str,
        message_id_hdr: str,
        in_reply_to: str | None,
        from_addr: str,
        from_name: str | None,
        to_addrs: list[str],
        cc_addrs: list[str],
        recipient_position: str,
        subject: str,
        subject_norm: str,
        received_at: datetime,
        body_text: str,
        ml_text: str,
        urls: list[dict[str, str]],
        attachments: list[dict[str, Any]],
        auth_results: dict[str, str | None] | None,
        raw_size: int,
        secret_types: list[str],
    ) -> StoreResult:
        """In one transaction: upsert thread, insert email (ON CONFLICT DO NOTHING), insert masked_secrets, update thread counters.

        Deliberate exception to FR-ING-011: on conflict, if the existing email is still in
        status='ingested' and was created within the last 24h, return should_publish=True
        so a crash between commit and Redis XADD recovers cleanly.
        """
        urls_json = _json_dumps(urls)
        atts_json = _json_dumps(attachments)
        auth_json = _json_dumps(auth_results) if auth_results is not None else None

        with self._conn_factory() as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    # 1. Upsert thread (do not bump message_count yet)
                    cur.execute(
                        """
                        INSERT INTO threads (
                            tenant_id, mailbox_id, provider_thread_id, subject_norm,
                            last_message_at, last_message_from_self, message_count
                        )
                        VALUES (%s::uuid, %s::uuid, %s, %s, %s, false, 0)
                        ON CONFLICT (mailbox_id, provider_thread_id) DO UPDATE
                        SET subject_norm = COALESCE(threads.subject_norm, EXCLUDED.subject_norm)
                        RETURNING id::text
                        """,
                        (mailbox.tenant_id, mailbox.id, provider_thread_id, subject_norm, received_at),
                    )
                    thread_id = str(cur.fetchone()[0])

                    # 2. Insert email with dedupe on (mailbox_id, message_id_hdr)
                    cur.execute(
                        """
                        INSERT INTO emails (
                            tenant_id, mailbox_id, thread_id, provider_message_id,
                            message_id_hdr, in_reply_to, from_addr, from_name,
                            to_addrs, cc_addrs, recipient_position,
                            subject, subject_norm, received_at,
                            body_text, ml_text, urls, attachments, auth_results,
                            raw_size, status
                        )
                        VALUES (
                            %s::uuid, %s::uuid, %s::uuid, %s,
                            %s, %s, %s, %s,
                            %s::text[], %s::text[], %s,
                            %s, %s, %s,
                            %s, %s, %s::jsonb, %s::jsonb, %s::jsonb,
                            %s, 'ingested'
                        )
                        ON CONFLICT (mailbox_id, message_id_hdr) DO NOTHING
                        RETURNING id::text, received_at
                        """,
                        (
                            mailbox.tenant_id,
                            mailbox.id,
                            thread_id,
                            provider_message_id,
                            message_id_hdr,
                            in_reply_to,
                            from_addr,
                            from_name,
                            to_addrs,
                            cc_addrs,
                            recipient_position,
                            subject,
                            subject_norm,
                            received_at,
                            body_text,
                            ml_text,
                            urls_json,
                            atts_json,
                            auth_json,
                            raw_size,
                        ),
                    )
                    inserted_row = cur.fetchone()

                    if inserted_row is not None:
                        email_id = str(inserted_row[0])
                        rec_dt: datetime = inserted_row[1]
                        # 3. Insert masked_secrets (value_enc MUST be NULL per C5)
                        if secret_types:
                            cur.executemany(
                                """
                                INSERT INTO masked_secrets (email_id, owner_user_id, secret_type, value_enc)
                                VALUES (%s::uuid, %s::uuid, %s, NULL)
                                """,
                                [(email_id, mailbox.user_id, st) for st in secret_types],
                            )
                        # 4. Update thread counters on genuine insert
                        cur.execute(
                            """
                            UPDATE threads
                            SET message_count = message_count + 1,
                                last_message_at = GREATEST(last_message_at, %s),
                                last_message_from_self = CASE
                                    WHEN last_message_at IS NULL OR %s >= last_message_at
                                    THEN false
                                    ELSE last_message_from_self
                                END
                            WHERE id = %s::uuid
                            """,
                            (received_at, received_at, thread_id),
                        )
                        return StoreResult(
                            email_id=email_id,
                            thread_id=thread_id,
                            inserted=True,
                            should_publish=True,
                            received_at_iso=rec_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                        )

                    # Conflict: deliberate exception to FR-ING-011 for crash-between-commit-and-publish
                    cur.execute(
                        """
                        SELECT id::text, thread_id::text, status, created_at, received_at
                        FROM emails
                        WHERE mailbox_id = %s::uuid AND message_id_hdr = %s
                        """,
                        (mailbox.id, message_id_hdr),
                    )
                    existing = cur.fetchone()
                    if existing is None:
                        raise RuntimeError("Conflict occurred but existing email row not found")

                    ex_id, ex_thread_id, ex_status, ex_created_at, ex_received_at = existing
                    cur.execute("SELECT now() - interval '24 hours'")
                    cutoff = cur.fetchone()[0]
                    should_pub = (ex_status == "ingested") and (ex_created_at >= cutoff)
                    return StoreResult(
                        email_id=str(ex_id),
                        thread_id=str(ex_thread_id or thread_id),
                        inserted=False,
                        should_publish=should_pub,
                        received_at_iso=ex_received_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                    )
