"""Shared Redis Stream constants and envelope builders (C2, C3)."""
from __future__ import annotations

from typing import Any

STREAM_EMAILS_INGESTED = "emails.ingested"
STREAM_EMAILS_DLQ = "emails.dlq"

INGESTED_MAXLEN = 100_000
DLQ_MAXLEN = 10_000

ENVELOPE_SCHEMA = "envelope.v1"


def build_ingested_envelope(
    *,
    email_id: str,
    tenant_id: str,
    mailbox_id: str,
    user_id: str,
    thread_id: str,
    received_at_iso: str,
    has_urls: bool,
) -> dict[str, Any]:
    return {
        "schema": ENVELOPE_SCHEMA,
        "email_id": str(email_id),
        "tenant_id": str(tenant_id),
        "mailbox_id": str(mailbox_id),
        "user_id": str(user_id),
        "thread_id": str(thread_id),
        "received_at": received_at_iso,
        "has_urls": bool(has_urls),
    }


def build_dlq_payload(
    *,
    stage: str,
    mailbox_id: str,
    provider_message_id: str,
    email_id: str | None,
    error: str,
) -> dict[str, Any]:
    return {
        "stage": stage,
        "mailbox_id": str(mailbox_id),
        "provider_message_id": str(provider_message_id),
        "email_id": str(email_id) if email_id is not None else None,
        "error": error[:240],
    }
