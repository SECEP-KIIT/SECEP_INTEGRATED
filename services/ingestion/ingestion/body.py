"""Canonical body selection and ML text derivation (FR-ING-007, FR-ING-008, C6)."""
from __future__ import annotations

from ingestion.masking_adapter import mask_text, mask_urls
from ingestion.mime_parser import ParsedEmail
from ingestion.sanitize import extract_bare_urls, merge_urls, sanitize_html
from ingestion.textprep import normalise, prepare_ml_text


def build_bodies_and_urls(
    parsed: ParsedEmail,
) -> tuple[str, str, list[dict[str, str]], list[str]]:
    """Compute (body_text, ml_text, urls, masked_secret_types) from a ParsedEmail."""
    plain_raw = "\n\n".join(p for p in parsed.plain_parts if p and p.strip())
    html_raw = "\n\n".join(h for h in parsed.html_parts if h and h.strip())

    html_text, html_urls = sanitize_html(html_raw) if html_raw else ("", [])
    plain_norm = normalise(plain_raw) if plain_raw else ""
    html_norm = normalise(html_text) if html_text else ""

    if plain_norm and html_norm:
        canonical = html_norm if len(html_norm) > len(plain_norm) else plain_norm
    elif html_norm:
        canonical = html_norm
    elif plain_norm:
        canonical = plain_norm
    elif parsed.calendar_parts:
        canonical = normalise("\n\n".join(parsed.calendar_parts))
    else:
        canonical = ""

    plain_urls = extract_bare_urls(plain_raw)
    urls = merge_urls(html_urls, plain_urls)

    # Mask canonical body first (C5) so placeholders survive into ml_text
    body_text, secret_types = mask_text(canonical)
    ml_text = prepare_ml_text(body_text)
    # Mask anchor text in urls while leaving href unmasked (C5)
    masked_urls = mask_urls(urls)

    return body_text, ml_text, masked_urls, secret_types
