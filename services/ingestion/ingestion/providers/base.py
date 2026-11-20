"""MailProvider protocol and shared provider data structures (C9)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


class InvalidGrantError(Exception):
    """Raised when OAuth refresh token is rejected with invalid_grant."""


class HistoryExpiredError(Exception):
    """Raised when Gmail historyId returns HTTP 404 (FR-ING-002)."""


class ProviderFetchError(Exception):
    """Raised when fetching a message fails persistently after retries (C3)."""

    def __init__(self, message: str, http_status: int | None = None) -> None:
        super().__init__(message)
        self.http_status = http_status


@dataclass(slots=True)
class RawMessage:
    provider_message_id: str
    provider_thread_id: str
    label_ids: tuple[str, ...]
    received_at: datetime
    size_estimate: int
    raw_bytes: bytes
    attachment_payload: dict[str, Any] | None = None


@dataclass(slots=True)
class HistoryResult:
    message_ids: list[str] = field(default_factory=list)
    newest_history_id: str | None = None


class MailProvider(Protocol):
    """Abstract mail provider interface (Gmail now; Outlook/Graph later)."""

    def get_access_token(self, refresh_token_plain: str, *, mailbox_id: str) -> str:
        """Exchange refresh token for a short-lived access token."""
        ...

    def get_profile_history_id(self, access_token: str, *, mailbox_id: str) -> str:
        """Return current mailbox historyId."""
        ...

    def list_backfill_message_ids(
        self, access_token: str, *, mailbox_id: str, query: str = "newer_than:7d"
    ) -> list[str]:
        """List message IDs for initial or 404-recovery backfill."""
        ...

    def list_history_message_ids(
        self, access_token: str, *, mailbox_id: str, start_history_id: str
    ) -> HistoryResult:
        """List message IDs added since start_history_id."""
        ...

    def get_raw_message(
        self, access_token: str, *, mailbox_id: str, message_id: str
    ) -> RawMessage:
        """Fetch raw RFC 5322 message bytes and metadata."""
        ...

    def get_message_payload(
        self, access_token: str, *, mailbox_id: str, message_id: str
    ) -> dict[str, Any]:
        """Fetch format=full payload tree (for Gmail attachmentId matching)."""
        ...
