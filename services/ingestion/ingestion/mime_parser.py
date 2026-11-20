"""MIME tree parser, header decoder, auth_results & attachment metadata extractor (FR-ING-003, FR-ING-004, C1)."""
from __future__ import annotations

import codecs
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from typing import Any

_PARSER = BytesParser(policy=policy.default)
_AUTH_VALID = frozenset({"pass", "fail", "softfail", "neutral", "none"})
_AUTH_KV_RE = re.compile(r"\b(spf|dkim|dmarc)\s*=\s*([a-zA-Z]+)", re.IGNORECASE)


@dataclass(slots=True)
class AttachmentMeta:
    filename: str
    mime: str
    size: int
    sha256: str
    attachment_id: str | None = None
    part_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "mime": self.mime,
            "size": self.size,
            "sha256": self.sha256,
            "attachment_id": self.attachment_id,
        }


@dataclass(slots=True)
class ParsedEmail:
    provider_message_id: str
    message_id_hdr: str
    in_reply_to: str | None
    references: list[str]
    from_addr: str
    from_name: str | None
    to_addrs: list[str]
    cc_addrs: list[str]
    subject: str
    date_header: datetime | None
    auth_results: dict[str, str | None] | None
    plain_parts: list[str] = field(default_factory=list)
    html_parts: list[str] = field(default_factory=list)
    calendar_parts: list[str] = field(default_factory=list)
    attachments: list[AttachmentMeta] = field(default_factory=list)
    raw_size: int = 0


def _decode_bytes(raw: bytes, charset: str | None) -> str:
    """Decode bytes to UTF-8 string, replacing undecodable bytes with U+FFFD.

    Missing or bogus charset is treated as latin-1, then cp1252.
    """
    if charset:
        try:
            codecs.lookup(charset)
            return raw.decode(charset, errors="replace")
        except LookupError:
            pass
    for fallback in ("latin-1", "cp1252"):
        try:
            return raw.decode(fallback, errors="replace")
        except Exception:
            continue
    return raw.decode("utf-8", errors="replace")


def _decode_header_value(raw_val: str | None) -> str:
    if not raw_val:
        return ""
    try:
        decoded_parts = decode_header(raw_val)
        out: list[str] = []
        for part, enc in decoded_parts:
            if isinstance(part, bytes):
                out.append(_decode_bytes(part, enc or "utf-8"))
            else:
                out.append(str(part))
        return "".join(out).strip()
    except Exception:
        try:
            return str(make_header(decode_header(raw_val))).strip()
        except Exception:
            return str(raw_val).strip()


def _parse_addr_list(raw_values: list[str]) -> list[str]:
    pairs = getaddresses(raw_values)
    out: list[str] = []
    seen: set[str] = set()
    for _, addr in pairs:
        cleaned = addr.strip().lower()
        if "@" in cleaned and cleaned not in seen:
            seen.add(cleaned)
            out.append(cleaned)
    return out


def _parse_from(raw_values: list[str]) -> tuple[str, str | None]:
    pairs = getaddresses(raw_values)
    for name, addr in pairs:
        cleaned = addr.strip().lower()
        if "@" in cleaned:
            decoded_name = _decode_header_value(name) if name else None
            return cleaned, (decoded_name or None)
    return "unknown@invalid", None


def parse_auth_results(headers: list[str]) -> dict[str, str | None] | None:
    """Parse Authentication-Results preferring mx.google.com."""
    if not headers:
        return None
    chosen = None
    for h in headers:
        if "mx.google.com" in h.lower():
            chosen = h
            break
    if chosen is None:
        chosen = headers[0]

    result: dict[str, str | None] = {"spf": None, "dkim": None, "dmarc": None}
    for key, val in _AUTH_KV_RE.findall(chosen):
        k = key.lower()
        v = val.lower()
        if v in _AUTH_VALID and result[k] is None:
            result[k] = v
    if all(v is None for v in result.values()):
        return None
    return result


def parse_mime_message(raw_bytes: bytes, provider_message_id: str) -> ParsedEmail:
    """Parse RFC 2045-2049 / 5322 raw email bytes into a ParsedEmail."""
    if not raw_bytes or not raw_bytes.strip():
        raise ValueError("Empty raw message")

    msg: EmailMessage = _PARSER.parsebytes(raw_bytes)
    if not msg.keys():
        raise ValueError("Malformed message: no RFC 5322 headers found")

    raw_msg_id = _decode_header_value(msg.get("Message-ID"))
    if raw_msg_id:
        if not raw_msg_id.startswith("<"):
            raw_msg_id = f"<{raw_msg_id}>"
        message_id_hdr = raw_msg_id
    else:
        message_id_hdr = f"<gmail-{provider_message_id}@secep.local>"

    in_reply_to = _decode_header_value(msg.get("In-Reply-To")) or None
    refs_raw = _decode_header_value(msg.get("References"))
    references = refs_raw.split() if refs_raw else []

    from_addr, from_name = _parse_from([str(v) for v in msg.get_all("From", [])])
    to_addrs = _parse_addr_list([str(v) for v in msg.get_all("To", [])])
    cc_addrs = _parse_addr_list([str(v) for v in msg.get_all("Cc", [])])
    subject = _decode_header_value(msg.get("Subject"))

    date_hdr: datetime | None = None
    raw_date = msg.get("Date")
    if raw_date:
        try:
            dt = parsedate_to_datetime(str(raw_date))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            date_hdr = dt.astimezone(timezone.utc)
        except Exception:
            date_hdr = None

    auth_headers = [str(v) for v in msg.get_all("Authentication-Results", [])]
    auth_results = parse_auth_results(auth_headers)

    plain_parts: list[str] = []
    html_parts: list[str] = []
    calendar_parts: list[str] = []
    attachments: list[AttachmentMeta] = []

    if msg.is_multipart():
        for idx, part in enumerate(_iter_leaves(msg)):
            if part.get_content_type() == "message/rfc822":
                _record_attached_message(part, part_id=str(idx), attachments=attachments)
                continue
            _extract_leaf_part(
                part,
                part_id=str(idx),
                plain_parts=plain_parts,
                html_parts=html_parts,
                calendar_parts=calendar_parts,
                attachments=attachments,
            )
    else:
        _extract_leaf_part(
            msg,
            part_id="0",
            plain_parts=plain_parts,
            html_parts=html_parts,
            calendar_parts=calendar_parts,
            attachments=attachments,
        )

    return ParsedEmail(
        provider_message_id=provider_message_id,
        message_id_hdr=message_id_hdr,
        in_reply_to=in_reply_to,
        references=references,
        from_addr=from_addr,
        from_name=from_name,
        to_addrs=to_addrs,
        cc_addrs=cc_addrs,
        subject=subject,
        date_header=date_hdr,
        auth_results=auth_results,
        plain_parts=plain_parts,
        html_parts=html_parts,
        calendar_parts=calendar_parts,
        attachments=attachments,
        raw_size=len(raw_bytes),
    )


def _iter_leaves(part: EmailMessage):
    """Yield leaf parts in document order, treating an attached message (message/rfc822) as one leaf.

    msg.walk() would descend into a forwarded .eml and merge its text into this email's body, so an old
    attached thread would be classified as if it were the new message.
    """
    if part.get_content_type() == "message/rfc822":
        yield part
        return
    if part.is_multipart():
        for child in part.iter_parts():
            yield from _iter_leaves(child)
        return
    yield part


def _record_attached_message(part: EmailMessage, *, part_id: str, attachments: list[AttachmentMeta]) -> None:
    """List an attached email (message/rfc822) as an attachment: metadata only, content never stored."""
    inner = part.get_payload()
    if isinstance(inner, list):
        inner = inner[0] if inner else None
    raw = inner.as_bytes() if inner is not None and hasattr(inner, "as_bytes") else b""
    raw_filename = part.get_filename()
    filename = _decode_header_value(raw_filename) if raw_filename else "attached-message.eml"
    attachments.append(
        AttachmentMeta(
            filename=filename,
            mime="message/rfc822",
            size=len(raw),
            sha256=hashlib.sha256(raw).hexdigest(),
            attachment_id=None,
            part_id=part_id,
        )
    )


def _extract_leaf_part(
    part: EmailMessage,
    *,
    part_id: str,
    plain_parts: list[str],
    html_parts: list[str],
    calendar_parts: list[str],
    attachments: list[AttachmentMeta],
) -> None:
    ctype = (part.get_content_type() or "application/octet-stream").lower()
    disp = (part.get_content_disposition() or "").lower()
    raw_filename = part.get_filename()
    filename = _decode_header_value(raw_filename) if raw_filename else ""

    payload_bytes = part.get_payload(decode=True)
    if payload_bytes is None:
        raw_payload = part.get_payload()
        if isinstance(raw_payload, str):
            payload_bytes = raw_payload.encode("utf-8", errors="replace")
        else:
            payload_bytes = b""

    is_attachment = disp == "attachment" or bool(filename) or (
        ctype not in ("text/plain", "text/html") and not ctype.startswith("multipart/")
    )

    if is_attachment and ctype not in ("text/plain", "text/html"):
        sha = hashlib.sha256(payload_bytes).hexdigest()
        attachments.append(
            AttachmentMeta(
                filename=filename or ("invite.ics" if ctype == "text/calendar" else "attachment"),
                mime=ctype,
                size=len(payload_bytes),
                sha256=sha,
                attachment_id=None,
                part_id=part_id,
            )
        )
        if ctype == "text/calendar":
            calendar_parts.append(_decode_bytes(payload_bytes, part.get_content_charset()))
        return

    if disp == "attachment":
        sha = hashlib.sha256(payload_bytes).hexdigest()
        attachments.append(
            AttachmentMeta(
                filename=filename or "attachment.txt",
                mime=ctype,
                size=len(payload_bytes),
                sha256=sha,
                attachment_id=None,
                part_id=part_id,
            )
        )
        return

    text = _decode_bytes(payload_bytes, part.get_content_charset())
    if ctype == "text/plain":
        plain_parts.append(text)
    elif ctype == "text/html":
        html_parts.append(text)


def attach_gmail_attachment_ids(attachments: list[AttachmentMeta], payload: dict[str, Any]) -> None:
    """Match Gmail format=full payload parts to extracted attachments by (filename, decoded size).

    Our local part numbering (msg.walk() order, which counts multipart containers) is NOT the same as Gmail's
    hierarchical partId ("0", "1", "0.1", ...), so partId is never used for matching: a wrong match would make
    the API stream a different file. Gmail's body.size is the decoded size, the same as AttachmentMeta.size.
    Both lists are in document order, so attachments with the same (filename, size) are paired in order.
    Anything left unmatched keeps attachment_id = None (FR-ING-003).
    """
    if not attachments or not payload:
        return

    queues: dict[tuple[str, int], list[str]] = {}

    def walk(node: dict[str, Any]) -> None:
        body = node.get("body") or {}
        att_id = body.get("attachmentId")
        if att_id:
            key = (str(node.get("filename") or ""), int(body.get("size") or 0))
            queues.setdefault(key, []).append(str(att_id))
        for child in node.get("parts") or []:
            walk(child)

    walk(payload)

    for att in attachments:
        q = queues.get((att.filename, att.size))
        if q:
            att.attachment_id = q.pop(0)
