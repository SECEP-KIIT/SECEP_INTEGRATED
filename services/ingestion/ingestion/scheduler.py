"""Per-mailbox polling orchestrator, locking, and graceful shutdown (steps 1-9)."""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from ingestion.body import build_bodies_and_urls
from ingestion.config import Config
from ingestion.crypto import decrypt
from ingestion.logging_ import log_event
from ingestion.masking_adapter import mask_text
from ingestion.mime_parser import attach_gmail_attachment_ids, parse_mime_message
from ingestion.providers.base import (
    HistoryExpiredError,
    InvalidGrantError,
    MailProvider,
    ProviderFetchError,
)
from ingestion.publisher import StreamPublisher
from ingestion.store import IngestionStore, MailboxRecord
from ingestion.threading_ import compute_recipient_position, normalize_subject

logger = logging.getLogger(__name__)

try:  # infrastructure failures must abort the poll (no checkpoint), not be dead-lettered per message
    import psycopg as _psycopg
    import redis as _redis

    _INFRA_ERRORS: tuple[type[BaseException], ...] = (
        _psycopg.OperationalError,
        _psycopg.InterfaceError,
        _redis.exceptions.ConnectionError,
        _redis.exceptions.TimeoutError,
    )
except ImportError:  # pragma: no cover
    _INFRA_ERRORS = ()

_SKIP_LABELS = frozenset({"DRAFT", "SPAM", "TRASH"})


class IngestionScheduler:
    """Stateless per-mailbox poll loop (DC-02, DC-03)."""

    def __init__(
        self,
        *,
        config: Config,
        store: IngestionStore,
        publisher: StreamPublisher,
        provider: MailProvider,
        master_key: bytes | None,
        conn_factory: Any,
    ) -> None:
        self._cfg = config
        self._store = store
        self._publisher = publisher
        self._provider = provider
        self._master_key = master_key
        self._conn_factory = conn_factory
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run_forever(self) -> None:
        log_event(logger, logging.INFO, "scheduler_started")
        while not self._stop_event.is_set():
            start = time.monotonic()
            try:
                self.poll_once()
            except Exception as exc:
                log_event(
                    logger,
                    logging.ERROR,
                    "poll_cycle_failed",
                    error_class=type(exc).__name__,
                )
            elapsed = time.monotonic() - start
            remaining = max(0.0, self._cfg.poll_interval_s - elapsed)
            if remaining > 0:
                self._stop_event.wait(remaining)
        log_event(logger, logging.INFO, "scheduler_stopped")

    def poll_once(self) -> None:
        if self._cfg.ingest_source == "fixtures":
            if not self._cfg.fixture_mailbox_id:
                raise ValueError("FIXTURE_MAILBOX_ID must be set when INGEST_SOURCE=fixtures")
            candidate_ids = [self._cfg.fixture_mailbox_id]
        else:
            candidate_ids = self._store.list_candidate_mailbox_ids(self._cfg.mailbox_ids)

        for mailbox_id in candidate_ids:
            if self._stop_event.is_set():
                break
            self._poll_mailbox(mailbox_id)

    def _poll_mailbox(self, mailbox_id: str) -> None:
        t0 = time.monotonic()
        with self._conn_factory() as lock_conn:
            with lock_conn.transaction():
                mailbox = self._store.try_lock_and_get_mailbox(lock_conn, mailbox_id)
                if mailbox is None:
                    return
                self._process_locked_mailbox(mailbox, t0)

    def _process_locked_mailbox(self, mailbox: MailboxRecord, t0: float) -> None:
        # Step 2: OAuth token refresh (skipped in fixtures mode)
        access_token = ""
        if self._cfg.ingest_source == "gmail":
            if self._master_key is None:
                raise RuntimeError("Master key not loaded")
            try:
                refresh_plain = decrypt(mailbox.refresh_token_enc, self._master_key)
                access_token = self._provider.get_access_token(
                    refresh_plain, mailbox_id=mailbox.id
                )
            except InvalidGrantError:
                self._store.mark_mailbox_error(mailbox.id)
                log_event(
                    logger,
                    logging.ERROR,
                    "mailbox_invalid_grant",
                    mailbox_id=mailbox.id,
                    error_class="InvalidGrantError",
                )
                return
            except ProviderFetchError as exc:
                log_event(
                    logger,
                    logging.ERROR,
                    "mailbox_token_fetch_failed",
                    mailbox_id=mailbox.id,
                    http_status=exc.http_status,
                    error_class=type(exc).__name__,
                )
                return

        # Step 3 & 4: First run backfill or incremental history.list
        newest_history_id: str | None = mailbox.history_id
        if mailbox.history_id is None:
            newest_history_id = self._provider.get_profile_history_id(
                access_token, mailbox_id=mailbox.id
            )
            message_ids = self._provider.list_backfill_message_ids(
                access_token, mailbox_id=mailbox.id, query="newer_than:7d"
            )
        else:
            try:
                hist = self._provider.list_history_message_ids(
                    access_token,
                    mailbox_id=mailbox.id,
                    start_history_id=mailbox.history_id,
                )
                message_ids = hist.message_ids
                newest_history_id = hist.newest_history_id or mailbox.history_id
            except HistoryExpiredError:
                log_event(
                    logger,
                    logging.WARNING,
                    "history_expired_resync",
                    mailbox_id=mailbox.id,
                    http_status=404,
                )
                newest_history_id = self._provider.get_profile_history_id(
                    access_token, mailbox_id=mailbox.id
                )
                message_ids = self._provider.list_backfill_message_ids(
                    access_token, mailbox_id=mailbox.id, query="newer_than:7d"
                )

        stored_count = 0
        dlq_count = 0
        for mid in message_ids:
            if self._stop_event.is_set():
                return
            try:
                ok = self._process_message(mailbox, access_token, mid)
            except _INFRA_ERRORS:
                raise  # Postgres/Redis unreachable: stop here, checkpoint not advanced, retried next cycle
            except Exception as exc:
                # One bad message must never stall the mailbox (poison message): dead-letter it and move on.
                self._publisher.publish_dlq(
                    stage="parse_error",
                    mailbox_id=mailbox.id,
                    provider_message_id=mid,
                    email_id=None,
                    error=f"{type(exc).__name__}: processing failed",
                )
                log_event(
                    logger,
                    logging.ERROR,
                    "message_processing_dlq",
                    mailbox_id=mailbox.id,
                    provider_message_id=mid,
                    stage="parse_error",
                    error_class=type(exc).__name__,
                )
                ok = False
            if ok is True:
                stored_count += 1
            elif ok is False:
                dlq_count += 1

        # Step 9: Update checkpoint only after every message in the batch is handled
        self._store.update_mailbox_checkpoint(mailbox.id, newest_history_id)
        log_event(
            logger,
            logging.INFO,
            "mailbox_polled",
            mailbox_id=mailbox.id,
            counts={"fetched": len(message_ids), "stored": stored_count, "dlq": dlq_count},
            duration_ms=round((time.monotonic() - t0) * 1000.0, 2),
        )

    def _process_message(
        self, mailbox: MailboxRecord, access_token: str, provider_message_id: str
    ) -> bool | None:
        """Process one message. Returns True if stored/published, False if DLQ, None if skipped."""
        try:
            raw_msg = self._provider.get_raw_message(
                access_token, mailbox_id=mailbox.id, message_id=provider_message_id
            )
        except ProviderFetchError as exc:
            self._publisher.publish_dlq(
                stage="fetch_error",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                email_id=None,
                error=f"{type(exc).__name__}: {exc}",
            )
            log_event(
                logger,
                logging.ERROR,
                "message_fetch_dlq",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                http_status=exc.http_status,
                stage="fetch_error",
                error_class=type(exc).__name__,
            )
            return False

        labels = set(raw_msg.label_ids)
        if labels & _SKIP_LABELS:
            return None

        if raw_msg.size_estimate > self._cfg.max_raw_bytes or len(raw_msg.raw_bytes) > self._cfg.max_raw_bytes:
            self._publisher.publish_dlq(
                stage="too_large",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                email_id=None,
                error=f"MessageTooLarge: {len(raw_msg.raw_bytes)} bytes",
            )
            log_event(
                logger,
                logging.WARNING,
                "message_too_large_dlq",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                stage="too_large",
            )
            return False

        try:
            parsed = parse_mime_message(raw_msg.raw_bytes, provider_message_id=provider_message_id)
        except Exception as exc:
            self._publisher.publish_dlq(
                stage="parse_error",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                email_id=None,
                error=f"{type(exc).__name__}: {exc}",
            )
            log_event(
                logger,
                logging.WARNING,
                "message_parse_dlq",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                stage="parse_error",
                error_class=type(exc).__name__,
            )
            return False

        # FR-SEC-006: the subject feeds storage, search, the encoder and the LLM prompt, so it is masked too.
        subject_masked, subject_secret_types = mask_text(parsed.subject)
        subject_norm = normalize_subject(subject_masked)

        # SENT messages (written by owner): create no emails row; only upsert thread
        if "SENT" in labels:
            self._store.upsert_sent_thread(
                tenant_id=mailbox.tenant_id,
                mailbox_id=mailbox.id,
                provider_thread_id=raw_msg.provider_thread_id,
                subject_norm=subject_norm,
                received_at=raw_msg.received_at,
            )
            return None

        # Fetch attachmentIds via format=full only when attachments exist (FR-ING-003)
        if parsed.attachments and self._cfg.ingest_source == "gmail":
            try:
                payload = self._provider.get_message_payload(
                    access_token, mailbox_id=mailbox.id, message_id=provider_message_id
                )
                attach_gmail_attachment_ids(parsed.attachments, payload)
            except ProviderFetchError:
                # Non-fatal: attachment_id stays null per FR-ING-003
                pass

        # Step 6: Sanitize, extract links, canonical body, ml_text, mask
        body_text, ml_text, urls, body_secret_types = build_bodies_and_urls(parsed)
        secret_types = subject_secret_types + body_secret_types
        recipient_pos = compute_recipient_position(
            mailbox.address, parsed.to_addrs, parsed.cc_addrs
        )
        attachments_dicts = [a.to_dict() for a in parsed.attachments]

        # Step 7: Store in one transaction
        try:
            res = self._store.store_email_and_secrets(
                mailbox=mailbox,
                provider_thread_id=raw_msg.provider_thread_id,
                provider_message_id=provider_message_id,
                message_id_hdr=parsed.message_id_hdr,
                in_reply_to=parsed.in_reply_to,
                from_addr=parsed.from_addr,
                from_name=parsed.from_name,
                to_addrs=parsed.to_addrs,
                cc_addrs=parsed.cc_addrs,
                recipient_position=recipient_pos,
                subject=subject_masked,
                subject_norm=subject_norm,
                received_at=raw_msg.received_at,
                body_text=body_text,
                ml_text=ml_text,
                urls=urls,
                attachments=attachments_dicts,
                auth_results=parsed.auth_results,
                raw_size=parsed.raw_size,
                secret_types=secret_types,
            )
        except _INFRA_ERRORS:
            raise
        except Exception as exc:
            self._publisher.publish_dlq(
                stage="store_error",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                email_id=None,
                error=f"{type(exc).__name__}: store failed",
            )
            log_event(
                logger,
                logging.ERROR,
                "message_store_dlq",
                mailbox_id=mailbox.id,
                provider_message_id=provider_message_id,
                stage="store_error",
                error_class=type(exc).__name__,
            )
            return False

        # Step 8: Publish after commit
        if res.should_publish:
            self._publisher.publish_ingested(
                email_id=res.email_id,
                tenant_id=mailbox.tenant_id,
                mailbox_id=mailbox.id,
                user_id=mailbox.user_id,
                thread_id=res.thread_id,
                received_at_iso=res.received_at_iso,
                has_urls=bool(urls),
            )
            log_event(
                logger,
                logging.INFO,
                "email_ingested",
                mailbox_id=mailbox.id,
                email_id=res.email_id,
                provider_message_id=provider_message_id,
                thread_id=res.thread_id,
                count=len(secret_types),
            )
            return True
        return None
