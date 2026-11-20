"""Gmail MailProvider implementation wrapping GmailClient."""
from __future__ import annotations

from typing import Any

from ingestion.gmail_client import GmailClient
from ingestion.providers.base import HistoryResult, RawMessage


class GmailProvider:
    def __init__(self, client: GmailClient) -> None:
        self._client = client

    def get_access_token(self, refresh_token_plain: str, *, mailbox_id: str) -> str:
        return self._client.refresh_access_token(refresh_token_plain, mailbox_id=mailbox_id)

    def get_profile_history_id(self, access_token: str, *, mailbox_id: str) -> str:
        return self._client.get_profile_history_id(access_token, mailbox_id=mailbox_id)

    def list_backfill_message_ids(
        self, access_token: str, *, mailbox_id: str, query: str = "newer_than:7d"
    ) -> list[str]:
        return self._client.list_messages(access_token, mailbox_id=mailbox_id, query=query)

    def list_history_message_ids(
        self, access_token: str, *, mailbox_id: str, start_history_id: str
    ) -> HistoryResult:
        return self._client.list_history(
            access_token, mailbox_id=mailbox_id, start_history_id=start_history_id
        )

    def get_raw_message(
        self, access_token: str, *, mailbox_id: str, message_id: str
    ) -> RawMessage:
        return self._client.get_raw_message(
            access_token, mailbox_id=mailbox_id, message_id=message_id
        )

    def get_message_payload(
        self, access_token: str, *, mailbox_id: str, message_id: str
    ) -> dict[str, Any]:
        return self._client.get_message_payload(
            access_token, mailbox_id=mailbox_id, message_id=message_id
        )
