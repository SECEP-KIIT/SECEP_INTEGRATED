"""Fixture MailProvider that replays .eml files from FIXTURES_DIR (no OAuth/Gmail calls)."""
from __future__ import annotations

from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Any

from ingestion.providers.base import HistoryResult, RawMessage
from ingestion.threading_ import normalize_subject, synthetic_thread_id

_HEADER_PARSER = BytesParser(policy=policy.default)


class FixtureProvider:
    """Replays .eml files from a local directory."""

    def __init__(self, fixtures_dir: str | Path) -> None:
        self._dir = Path(fixtures_dir)

    def _eml_files(self) -> list[Path]:
        if not self._dir.exists():
            return []
        return sorted(p for p in self._dir.iterdir() if p.is_file() and p.suffix.lower() == ".eml")

    def get_access_token(self, refresh_token_plain: str, *, mailbox_id: str) -> str:
        return "fixture-no-token"

    # The fixture "historyId" is "fx:<n>": the first n files (in sorted-name order) have been handed out.
    # Files already ingested are not replayed, so the event stream and the DLQ are not flooded every cycle.
    # New files dropped into the folder are picked up on the next poll if their names sort after the existing
    # ones (e.g. 60_new.eml). To replay everything, set mailboxes.history_id to NULL.
    _PREFIX = "fx:"

    def _cursor(self) -> str:
        return f"{self._PREFIX}{len(self._eml_files())}"

    def get_profile_history_id(self, access_token: str, *, mailbox_id: str) -> str:
        return self._cursor()

    def list_backfill_message_ids(
        self, access_token: str, *, mailbox_id: str, query: str = "newer_than:7d"
    ) -> list[str]:
        return [p.stem for p in self._eml_files()]

    def list_history_message_ids(
        self, access_token: str, *, mailbox_id: str, start_history_id: str
    ) -> HistoryResult:
        files = self._eml_files()
        seen = 0
        if start_history_id.startswith(self._PREFIX):
            try:
                seen = max(0, int(start_history_id[len(self._PREFIX):]))
            except ValueError:
                seen = 0
        # Unknown cursor (e.g. an old "fixture-1" value): replay all; dedupe in the store absorbs repeats.
        return HistoryResult(
            message_ids=[p.stem for p in files[seen:]],
            newest_history_id=f"{self._PREFIX}{len(files)}",
        )

    def get_raw_message(
        self, access_token: str, *, mailbox_id: str, message_id: str
    ) -> RawMessage:
        path = self._dir / f"{message_id}.eml"
        raw_bytes = path.read_bytes()

        # Derive synthetic threadId and received_at from Date header
        msg = _HEADER_PARSER.parsebytes(raw_bytes, headersonly=True)
        subj_norm = normalize_subject(str(msg.get("Subject") or ""))
        participants = [
            addr.lower()
            for _, addr in getaddresses(
                [str(v) for v in msg.get_all("From", []) + msg.get_all("To", []) + msg.get_all("Cc", [])]
            )
            if "@" in addr
        ]
        thread_id = synthetic_thread_id(subj_norm, participants)

        received_at = datetime.now(timezone.utc)
        raw_date = msg.get("Date")
        if raw_date:
            try:
                dt = parsedate_to_datetime(str(raw_date))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                received_at = dt.astimezone(timezone.utc)
            except Exception:
                pass

        # Optional X-Fixture-Labels header for testing SENT/DRAFT/SPAM/TRASH in fixture mode
        labels_raw = str(msg.get("X-Fixture-Labels") or "INBOX")
        labels = tuple(x.strip().upper() for x in labels_raw.split(",") if x.strip())

        return RawMessage(
            provider_message_id=message_id,
            provider_thread_id=thread_id,
            label_ids=labels,
            received_at=received_at,
            size_estimate=len(raw_bytes),
            raw_bytes=raw_bytes,
        )

    def get_message_payload(
        self, access_token: str, *, mailbox_id: str, message_id: str
    ) -> dict[str, Any]:
        return {}
