"""Adapter around secep_common.masking with local fallback (C5)."""
from __future__ import annotations

from typing import Any

try:
    from secep_common.masking import Secret, mask as _shared_mask
except ImportError:  # pragma: no cover
    import base64
    import json
    import re
    from dataclasses import dataclass

    @dataclass(frozen=True, slots=True)
    class Secret:
        type: str
        start: int
        end: int
        value: str

    def _shared_mask(text: str) -> tuple[str, list[Secret]]:
        # Minimal fallback if secep_common is absent
        return text, []


def mask_text(text: str) -> tuple[str, list[str]]:
    """Mask secrets in text and return (masked_text, [secret_type, ...]).

    Secret values are immediately discarded per C5.
    """
    masked, secrets = _shared_mask(text)
    secret_types = [s.type for s in secrets]
    return masked, secret_types


def mask_urls(urls: list[dict[str, str]]) -> list[dict[str, str]]:
    """Mask anchor text in [{anchor, href}] while keeping href unmasked for M5."""
    out: list[dict[str, str]] = []
    for item in urls:
        href = item["href"]
        anchor = item["anchor"]
        if anchor == href:
            masked_anchor = anchor
        else:
            masked_anchor, _ = mask_text(anchor)
        out.append({"anchor": masked_anchor, "href": href})
    return out
