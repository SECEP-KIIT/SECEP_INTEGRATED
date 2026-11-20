"""Subject normalization, recipient position, and thread upsert helpers (C1, FR-ING-010)."""
from __future__ import annotations

import hashlib
import re

_PREFIX_RE = re.compile(r"^(?:(?:re|fw|fwd|aw)\s*:\s*|\[[^\]]{1,40}\]\s*)+", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")


def normalize_subject(subject: str | None) -> str:
    """Lower-case, strip leading re:/fw:/fwd:/aw:/[tag] prefixes, collapse whitespace, trim."""
    if not subject:
        return ""
    s = subject.strip()
    while True:
        new_s = _PREFIX_RE.sub("", s).strip()
        if new_s == s:
            break
        s = new_s
    return _WS_RE.sub(" ", s).lower().strip()


def normalize_email_for_match(addr: str) -> str:
    """Normalize an email address for recipient_position comparison (ignore +tag and Gmail dots)."""
    cleaned = addr.strip().lower()
    if "@" not in cleaned:
        return cleaned
    local, domain = cleaned.split("@", 1)
    if "+" in local:
        local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def compute_recipient_position(
    mailbox_address: str,
    to_addrs: list[str],
    cc_addrs: list[str],
) -> str:
    """Return 'to', 'cc', or 'bcc' by comparing mailbox_address against To then Cc."""
    target = normalize_email_for_match(mailbox_address)
    if any(normalize_email_for_match(a) == target for a in to_addrs):
        return "to"
    if any(normalize_email_for_match(a) == target for a in cc_addrs):
        return "cc"
    return "bcc"


def synthetic_thread_id(subject_norm: str, participants: list[str]) -> str:
    """Deterministic synthetic threadId for fixture mode."""
    norm_parts = sorted({normalize_email_for_match(p) for p in participants if "@" in p})
    seed = f"{subject_norm}|{'|'.join(norm_parts)}"
    return "fx-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
