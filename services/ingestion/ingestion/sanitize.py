"""HTML sanitization to safe plain text and URL extraction (FR-ING-005, FR-ING-006)."""
from __future__ import annotations

import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag

_STRIP_TAGS = ("script", "style", "iframe", "object", "embed", "form", "link", "meta", "head", "title")
_ALLOWED_SCHEMES = frozenset({"http", "https", "mailto"})
_BARE_URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]{}]+", re.IGNORECASE)
_MULTI_BLANK_RE = re.compile(r"\n{3,}")


def _is_safe_href(href: str) -> bool:
    if not href:
        return False
    low = href.strip().lower()
    if low.startswith(("javascript:", "data:", "vbscript:")):
        return False
    parsed = urlparse(href.strip())
    return parsed.scheme.lower() in _ALLOWED_SCHEMES


def sanitize_html(html_text: str) -> tuple[str, list[dict[str, str]]]:
    """Sanitize HTML into safe plain text and extract [{anchor, href}] links."""
    if not html_text:
        return "", []

    soup = BeautifulSoup(html_text, "lxml")

    for tag_name in _STRIP_TAGS:
        for el in soup.find_all(tag_name):
            el.decompose()

    # Remove remote images and all on* attributes
    for el in list(soup.find_all(True)):
        if not isinstance(el, Tag):
            continue
        if el.name == "img":
            el.decompose()
            continue
        for attr in list(el.attrs.keys()):
            if attr.lower().startswith("on"):
                del el.attrs[attr]

    # Extract links from <a href=...>
    links: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        if _is_safe_href(href):
            anchor = " ".join(a.get_text(" ", strip=True).split()) or href
            key = (anchor, href)
            if key not in seen:
                seen.add(key)
                links.append({"anchor": anchor, "href": href})
        else:
            # Strip unsafe href attribute
            if "href" in a.attrs:
                del a.attrs["href"]

    # Convert structural tags to plain-text breaks / list markers
    for br in soup.find_all("br"):
        br.replace_with("\n")

    for li in soup.find_all("li"):
        li.insert_before("\n- ")
        li.append("\n")

    for block in soup.find_all(["p", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "article"]):
        block.insert_before("\n")
        block.append("\n")

    text = soup.get_text()
    lines = [" ".join(line.split()) if not line.lstrip().startswith("- ") else "- " + " ".join(line.lstrip()[2:].split()) for line in text.splitlines()]
    joined = "\n".join(lines)
    joined = _MULTI_BLANK_RE.sub("\n\n", joined).strip()
    return joined, links


def extract_bare_urls(plain_text: str) -> list[dict[str, str]]:
    """Extract bare http(s):// URLs from plain text as [{anchor, href}]."""
    if not plain_text:
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for m in _BARE_URL_RE.finditer(plain_text):
        url = m.group(0).rstrip(".,;:!?)")
        if _is_safe_href(url) and url not in seen:
            seen.add(url)
            out.append({"anchor": url, "href": url})
    return out


def merge_urls(*url_lists: list[dict[str, str]]) -> list[dict[str, str]]:
    """Deduplicate [{anchor, href}] across HTML and plain-text extractions."""
    merged: list[dict[str, str]] = []
    seen_hrefs: set[tuple[str, str]] = set()
    hrefs_from_html: set[str] = set()

    for idx, lst in enumerate(url_lists):
        for item in lst:
            href = item["href"]
            anchor = item["anchor"]
            if idx == 0:
                hrefs_from_html.add(href)
            elif href in hrefs_from_html and anchor == href:
                continue
            key = (anchor, href)
            if key not in seen_hrefs:
                seen_hrefs.add(key)
                merged.append({"anchor": anchor, "href": href})
    return merged
