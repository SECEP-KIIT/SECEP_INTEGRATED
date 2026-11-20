"""ML text preparation reproducing ML_Training/common/text.py (C7)."""
from __future__ import annotations

import re
import unicodedata

MAX_BODY_CHARS = 20000

# Exact _QUOTE_START and _FORWARD patterns from ML_Training/common/text.py
_QUOTE_START = re.compile(
    r"(?:^|\n)[ \t]*(?:"
    r"-{2,}\s*Original Message\s*-{2,}"
    r"|-{2,}\s*Original Appointment\s*-{2,}"
    r"|_{10,}\s*\n\s*From:"
    r"|From:[^\n]{1,200}\n[ \t]*Sent:[^\n]*\n"
    r"|On [^\n]{5,200}(?:\n[^\n]{0,200})?wrote:[ \t]*\n"
    r"|[^\n]{1,80}\n[ \t]*\d{1,2}/\d{1,2}/\d{2,4} \d{1,2}:\d{2}(?::\d{2})? ?[AP]M\s*\n[ \t]*To:"
    r")",
    re.I,
)
_FORWARD = re.compile(
    r"-{2,}\s*Forwarded by|-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:",
    re.I,
)
_SIG_RE = re.compile(r"(?:^|\n)(?:--\s*\n|__\s*\n|Sent from my (?:iPhone|iPad|Android|Galaxy|Pixel))", re.I)

_INVISIBLE = dict.fromkeys(c for c in range(0x20) if c not in (9, 10))
_INVISIBLE.update({0x200B: None, 0x200C: None, 0x200D: None, 0xFEFF: None, 0x00AD: None})


def normalise(text: str) -> str:
    """Exact normalise() from ML_Training/common/text.py."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = unicodedata.normalize("NFKC", text).translate(_INVISIBLE)
    text = text.replace("\t", " ").replace("\u00a0", " ")
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_quoted(body: str) -> tuple[str, str]:
    """Exact split_quoted() from ML_Training/common/text.py."""
    m = _QUOTE_START.search(body)
    if m:
        fwd = _FORWARD.search(body)
        if fwd and fwd.start() < m.start():
            m = None
    new, quoted = (body[: m.start()], body[m.start() :]) if m else (body, "")
    keep, qlines = [], []
    for ln in new.split("\n"):
        (qlines if ln.lstrip().startswith(">") else keep).append(ln)
    quoted = "\n".join(qlines + ([quoted] if quoted else []))
    return "\n".join(keep), quoted.strip()


def strip_signature(text: str) -> str:
    """Strip standard email signatures if not already removed by email-reply-parser."""
    m = _SIG_RE.search(text)
    if m:
        return text[: m.start()].rstrip()
    return text


def prepare_ml_text(masked_canonical_body: str) -> str:
    """Derive ml_text from the masked canonical body (FR-ING-008 + C7).

    Train/serve parity: only the body-cleaning steps of ML_Training/common/text.py are applied
    (split_quoted -> normalise -> MAX_BODY_CHARS), because the triage encoder was trained on exactly that.
    email-reply-parser and the extra signature stripper were removed on purpose: training never saw them,
    so they would shift the text the model receives. strip_signature() is kept above for reference only.
    Masking is already applied before this step, so [MASKED:<type>] placeholders survive intact.
    """
    text = masked_canonical_body.replace("\r\n", "\n")
    new_text, _ = split_quoted(text)
    return normalise(new_text)[:MAX_BODY_CHARS]
