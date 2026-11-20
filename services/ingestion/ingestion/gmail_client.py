"""Gmail REST API & OAuth2 client with exponential backoff (FR-ING-001..004, FR-ING-013)."""
from __future__ import annotations

import base64
import logging
import random
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable

import httpx

from ingestion.logging_ import log_event
from ingestion.providers.base import (
    HistoryExpiredError,
    HistoryResult,
    InvalidGrantError,
    ProviderFetchError,
    RawMessage,
)

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

MAX_ATTEMPTS = 5
BASE_BACKOFF_S = 1.0
BACKOFF_FACTOR = 2.0


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    value = value.strip()
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            dt = parsedate_to_datetime(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return max(0.0, (dt - datetime.now(timezone.utc)).total_seconds())
        except Exception:
            return None


def compute_backoff(attempt: int, retry_after_header: str | None = None) -> float:
    """Exponential backoff: 1s base, factor 2, full jitter, honoring Retry-After."""
    ra = _parse_retry_after(retry_after_header)
    if ra is not None:
        return ra
    cap = BASE_BACKOFF_S * (BACKOFF_FACTOR ** (attempt - 1))
    return random.uniform(0.0, cap)


class GmailClient:
    """Stateless HTTP client for Gmail API (scope: gmail.readonly)."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        http_client: httpx.Client | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        timeout_s: float = 30.0,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._client = http_client or httpx.Client(timeout=timeout_s)
        self._owns_client = http_client is None
        self._sleep = sleep_fn

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        mailbox_id: str,
        provider_message_id: str | None = None,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | list[tuple[str, str]] | None = None,
        data: dict[str, str] | None = None,
    ) -> httpx.Response:
        last_status: int | None = None
        last_exc: Exception | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                resp = self._client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    data=data,
                )
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt == MAX_ATTEMPTS:
                    raise ProviderFetchError(f"{type(exc).__name__}: transport error") from exc
                wait_s = compute_backoff(attempt)
                log_event(
                    logger,
                    logging.WARNING,
                    "gmail_retry",
                    mailbox_id=mailbox_id,
                    provider_message_id=provider_message_id,
                    attempt=attempt,
                    wait_s=round(wait_s, 3),
                    error_class=type(exc).__name__,
                )
                self._sleep(wait_s)
                continue

            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                last_status = resp.status_code
                if attempt == MAX_ATTEMPTS:
                    raise ProviderFetchError(
                        f"HTTP {resp.status_code} after {MAX_ATTEMPTS} attempts",
                        http_status=resp.status_code,
                    )
                wait_s = compute_backoff(attempt, resp.headers.get("Retry-After"))
                log_event(
                    logger,
                    logging.WARNING,
                    "gmail_retry",
                    mailbox_id=mailbox_id,
                    provider_message_id=provider_message_id,
                    attempt=attempt,
                    http_status=resp.status_code,
                    wait_s=round(wait_s, 3),
                )
                self._sleep(wait_s)
                continue

            return resp

        raise ProviderFetchError(
            f"HTTP {last_status}" if last_status else f"{type(last_exc).__name__}",
            http_status=last_status,
        )

    def refresh_access_token(self, refresh_token_plain: str, *, mailbox_id: str) -> str:
        resp = self._request_with_retry(
            "POST",
            TOKEN_URL,
            mailbox_id=mailbox_id,
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": refresh_token_plain,
                "grant_type": "refresh_token",
            },
        )
        if resp.status_code >= 400:
            try:
                err_code = resp.json().get("error", "")
            except Exception:
                err_code = ""
            if err_code == "invalid_grant" or resp.status_code in (400, 401):
                if err_code == "invalid_grant":
                    raise InvalidGrantError("invalid_grant")
            raise ProviderFetchError(
                f"Token refresh failed HTTP {resp.status_code}",
                http_status=resp.status_code,
            )
        token = resp.json().get("access_token")
        if not token:
            raise ProviderFetchError("Token response missing access_token")
        return str(token)

    def get_profile_history_id(self, access_token: str, *, mailbox_id: str) -> str:
        resp = self._request_with_retry(
            "GET",
            f"{GMAIL_BASE}/profile",
            mailbox_id=mailbox_id,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if resp.status_code >= 400:
            raise ProviderFetchError(f"getProfile HTTP {resp.status_code}", http_status=resp.status_code)
        return str(resp.json()["historyId"])

    def list_messages(
        self,
        access_token: str,
        *,
        mailbox_id: str,
        query: str = "newer_than:7d",
    ) -> list[str]:
        ids: list[str] = []
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {"q": query, "maxResults": 500}
            if page_token:
                params["pageToken"] = page_token
            resp = self._request_with_retry(
                "GET",
                f"{GMAIL_BASE}/messages",
                mailbox_id=mailbox_id,
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            if resp.status_code >= 400:
                raise ProviderFetchError(f"messages.list HTTP {resp.status_code}", http_status=resp.status_code)
            body = resp.json()
            for item in body.get("messages") or []:
                if "id" in item:
                    ids.append(str(item["id"]))
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return ids

    def list_history(
        self,
        access_token: str,
        *,
        mailbox_id: str,
        start_history_id: str,
    ) -> HistoryResult:
        msg_ids: list[str] = []
        seen: set[str] = set()
        newest_history_id: str | None = None
        page_token: str | None = None

        while True:
            params: list[tuple[str, str]] = [
                ("startHistoryId", str(start_history_id)),
                ("historyTypes", "messageAdded"),
                ("maxResults", "500"),
            ]
            if page_token:
                params.append(("pageToken", page_token))
            resp = self._request_with_retry(
                "GET",
                f"{GMAIL_BASE}/history",
                mailbox_id=mailbox_id,
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            if resp.status_code == 404:
                raise HistoryExpiredError("Gmail historyId expired (404)")
            if resp.status_code >= 400:
                raise ProviderFetchError(f"history.list HTTP {resp.status_code}", http_status=resp.status_code)

            body = resp.json()
            if body.get("historyId"):
                newest_history_id = str(body["historyId"])
            for record in body.get("history") or []:
                for added in record.get("messagesAdded") or []:
                    msg = added.get("message") or {}
                    mid = msg.get("id")
                    if mid and mid not in seen:
                        seen.add(mid)
                        msg_ids.append(str(mid))
            page_token = body.get("nextPageToken")
            if not page_token:
                break

        return HistoryResult(message_ids=msg_ids, newest_history_id=newest_history_id)

    def get_raw_message(
        self,
        access_token: str,
        *,
        mailbox_id: str,
        message_id: str,
    ) -> RawMessage:
        resp = self._request_with_retry(
            "GET",
            f"{GMAIL_BASE}/messages/{message_id}",
            mailbox_id=mailbox_id,
            provider_message_id=message_id,
            headers={"Authorization": f"Bearer {access_token}"},
            params={"format": "raw"},
        )
        if resp.status_code >= 400:
            raise ProviderFetchError(
                f"messages.get(raw) HTTP {resp.status_code}",
                http_status=resp.status_code,
            )
        data = resp.json()
        raw_b64 = data.get("raw", "")
        # Gmail uses URL-safe base64 without padding
        padded = raw_b64 + "=" * (-len(raw_b64) % 4)
        raw_bytes = base64.urlsafe_b64decode(padded.encode("ascii"))

        internal_ms = int(data.get("internalDate") or 0)
        if internal_ms > 0:
            received_at = datetime.fromtimestamp(internal_ms / 1000.0, tz=timezone.utc)
        else:
            received_at = datetime.now(timezone.utc)

        return RawMessage(
            provider_message_id=str(data.get("id") or message_id),
            provider_thread_id=str(data.get("threadId") or message_id),
            label_ids=tuple(str(x) for x in (data.get("labelIds") or [])),
            received_at=received_at,
            size_estimate=int(data.get("sizeEstimate") or len(raw_bytes)),
            raw_bytes=raw_bytes,
        )

    def get_message_payload(
        self,
        access_token: str,
        *,
        mailbox_id: str,
        message_id: str,
    ) -> dict[str, Any]:
        resp = self._request_with_retry(
            "GET",
            f"{GMAIL_BASE}/messages/{message_id}",
            mailbox_id=mailbox_id,
            provider_message_id=message_id,
            headers={"Authorization": f"Bearer {access_token}"},
            params={"format": "full", "fields": "payload"},
        )
        if resp.status_code >= 400:
            raise ProviderFetchError(
                f"messages.get(full) HTTP {resp.status_code}",
                http_status=resp.status_code,
            )
        return dict(resp.json().get("payload") or {})
