"""Redis Stream publisher for emails.ingested (C2) and emails.dlq (C3)."""
from __future__ import annotations

import json
from typing import Any

try:
    import orjson

    def _dumps(obj: dict[str, Any]) -> str:
        return orjson.dumps(obj).decode("utf-8")
except ImportError:
    def _dumps(obj: dict[str, Any]) -> str:
        return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)

try:
    from secep_common.streams import (
        DLQ_MAXLEN,
        INGESTED_MAXLEN,
        STREAM_EMAILS_DLQ,
        STREAM_EMAILS_INGESTED,
        build_dlq_payload,
        build_ingested_envelope,
    )
except ImportError:  # pragma: no cover
    STREAM_EMAILS_INGESTED = "emails.ingested"
    STREAM_EMAILS_DLQ = "emails.dlq"
    INGESTED_MAXLEN = 100_000
    DLQ_MAXLEN = 10_000

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
            "schema": "envelope.v1",
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


class StreamPublisher:
    """Publishes ingestion envelopes and DLQ events to Redis Streams."""

    def __init__(self, redis_client: Any) -> None:
        self._redis = redis_client

    def ping(self) -> bool:
        try:
            return bool(self._redis.ping())
        except Exception:
            return False

    def publish_ingested(
        self,
        *,
        email_id: str,
        tenant_id: str,
        mailbox_id: str,
        user_id: str,
        thread_id: str,
        received_at_iso: str,
        has_urls: bool,
    ) -> str:
        envelope = build_ingested_envelope(
            email_id=email_id,
            tenant_id=tenant_id,
            mailbox_id=mailbox_id,
            user_id=user_id,
            thread_id=thread_id,
            received_at_iso=received_at_iso,
            has_urls=has_urls,
        )
        return str(
            self._redis.xadd(
                STREAM_EMAILS_INGESTED,
                {"data": _dumps(envelope)},
                maxlen=INGESTED_MAXLEN,
                approximate=True,
            )
        )

    def publish_dlq(
        self,
        *,
        stage: str,
        mailbox_id: str,
        provider_message_id: str,
        email_id: str | None,
        error: str,
    ) -> str:
        payload = build_dlq_payload(
            stage=stage,
            mailbox_id=mailbox_id,
            provider_message_id=provider_message_id,
            email_id=email_id,
            error=error,
        )
        return str(
            self._redis.xadd(
                STREAM_EMAILS_DLQ,
                {"data": _dumps(payload)},
                maxlen=DLQ_MAXLEN,
                approximate=True,
            )
        )
