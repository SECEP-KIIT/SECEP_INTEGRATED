"""Shared credential masking for SECEP (C5 contract)."""
from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass

SECRET_TYPES = frozenset({
    "password",
    "api_key",
    "aws_key",
    "private_key",
    "jwt",
    "otp",
    "card",
})


@dataclass(frozen=True, slots=True)
class Secret:
    type: str
    start: int
    end: int
    value: str


_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----"
)
_JWT_RE = re.compile(
    r"\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b"
)
_AWS_KEY_RE = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
_API_KEY_LABELED_RE = re.compile(
    r"(?i)\b(?:api[_ -]?key|x-api-key|secret[_ -]?key|client[_ -]?secret|auth[_ -]?token|access[_ -]?token|bearer|token|secret)\b"
    r"(\s*(?:is|=|:|-)\s*)([A-Za-z0-9_\-./+=]{12,128})"
)
_KNOWN_PREFIX_KEY_RE = re.compile(
    r"\b(?:sk-(?:live|test|proj)?-?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b"
)
_PASSWORD_RE = re.compile(
    r"(?i)\b(?:temp(?:orary)?\s+)?(?:pass(?:word|wd|code)?|pwd|pass)\b(\s*(?:is\s*[:=]|is|=|:|-)\s*)(\S{3,64})"
)
_OTP_RE = re.compile(
    r"(?i)\b(?:one[- ]time(?:\s+(?:password|passcode|code|pin))?|otp|verification\s+code|security\s+code|2fa\s+code|mfa\s+code|login\s+code|auth(?:entication)?\s+code)\b"
    r"[^0-9\n]{0,40}?\b(\d{4,8})\b"
)
_OTP_REV_RE = re.compile(
    r"(?i)\b(\d{4,8})\b[^0-9\n]{0,40}?\b(?:is\s+your\s+)?(?:one[- ]time(?:\s+(?:password|passcode|code|pin))?|otp|verification\s+code|security\s+code|2fa\s+code|mfa\s+code)\b"
)
_CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")


def _is_valid_jwt_header(token: str) -> bool:
    header_b64 = token.split(".", 1)[0]
    padded = header_b64 + "=" * (-len(header_b64) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        obj = json.loads(decoded.decode("utf-8"))
        return isinstance(obj, dict) and "alg" in obj
    except Exception:
        return False


def _luhn_valid(digits: str) -> bool:
    if not (13 <= len(digits) <= 19) or len(set(digits)) == 1:
        return False
    total = 0
    alt = False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def _has_digit_or_symbol(val: str) -> bool:
    return any(c.isdigit() or not c.isalnum() for c in val)


def _looks_high_entropy(val: str) -> bool:
    if len(val) < 12 or val.startswith("[MASKED:"):
        return False
    has_alpha = any(c.isalpha() for c in val)
    has_digit_or_sym = any(c.isdigit() or c in "_-./+=" for c in val)
    return has_alpha and has_digit_or_sym


def mask(text: str) -> tuple[str, list[Secret]]:
    """Mask credentials in text, returning (masked_text, [Secret(type, start, end, value)])."""
    if not text:
        return text, []

    candidates: list[Secret] = []

    for m in _PRIVATE_KEY_RE.finditer(text):
        candidates.append(Secret("private_key", m.start(), m.end(), m.group(0)))

    for m in _JWT_RE.finditer(text):
        val = m.group(0)
        if _is_valid_jwt_header(val):
            candidates.append(Secret("jwt", m.start(), m.end(), val))

    for m in _AWS_KEY_RE.finditer(text):
        candidates.append(Secret("aws_key", m.start(), m.end(), m.group(0)))

    for m in _KNOWN_PREFIX_KEY_RE.finditer(text):
        candidates.append(Secret("api_key", m.start(), m.end(), m.group(0)))

    for m in _API_KEY_LABELED_RE.finditer(text):
        val = m.group(2).rstrip(".,;)")
        if _looks_high_entropy(val):
            start = m.start(2)
            candidates.append(Secret("api_key", start, start + len(val), val))

    for m in _PASSWORD_RE.finditer(text):
        val = m.group(2).rstrip(".,;)")
        if not val or val.startswith("[MASKED:"):
            continue
        sep = m.group(1).strip().lower()
        label = m.group(0)[: m.start(1) - m.start(0)].strip().lower()
        # A plain word after a weak cue ("password is changing", "boarding pass: Gate 5", "pass - the ball")
        # is prose, not a credential. Weak cue = separator "is"/"-", or the bare word "pass". Strong cues
        # ("password:", "pwd=", "passcode:") still mask any value.
        weak = sep in ("is", "-") or label.endswith("pass") and not label.endswith(("password", "passwd", "passcode"))
        if weak and not _has_digit_or_symbol(val):
            continue
        start = m.start(2)
        candidates.append(Secret("password", start, start + len(val), val))

    for m in _OTP_RE.finditer(text):
        candidates.append(Secret("otp", m.start(1), m.end(1), m.group(1)))

    for m in _OTP_REV_RE.finditer(text):
        candidates.append(Secret("otp", m.start(1), m.end(1), m.group(1)))

    for m in _CARD_RE.finditer(text):
        raw = m.group(0).strip()
        digits = re.sub(r"\D", "", raw)
        if _luhn_valid(digits):
            start = m.start() + (len(m.group(0)) - len(m.group(0).lstrip()))
            end = start + len(raw)
            candidates.append(Secret("card", start, end, raw))

    # Deduplicate overlapping spans: prefer earlier start, then longer span
    candidates.sort(key=lambda s: (s.start, -(s.end - s.start)))
    accepted: list[Secret] = []
    last_end = 0
    for s in candidates:
        if s.start >= last_end:
            accepted.append(s)
            last_end = s.end

    if not accepted:
        return text, []

    parts: list[str] = []
    pos = 0
    for s in accepted:
        parts.append(text[pos:s.start])
        parts.append(f"[MASKED:{s.type}]")
        pos = s.end
    parts.append(text[pos:])
    return "".join(parts), accepted
