"""Tests for HTML sanitization and URL extraction (FR-ING-005, FR-ING-006)."""
from __future__ import annotations

import unittest
from pathlib import Path

from ingestion.mime_parser import parse_mime_message
from ingestion.sanitize import extract_bare_urls, merge_urls, sanitize_html

FIXTURES = Path(__file__).parent / "fixtures"


class TestSanitize(unittest.TestCase):
    def test_xss_stripped_and_safe_links_kept(self) -> None:
        parsed = parse_mime_message((FIXTURES / "10_xss_html.eml").read_bytes(), "msg-10")
        text, urls = sanitize_html(parsed.html_parts[0])
        self.assertNotIn("alert(", text)
        self.assertNotIn("<script", text.lower())
        self.assertNotIn("tracker.evil.example", text)
        self.assertIn("Verify Account", text)
        self.assertEqual(
            urls,
            [{"anchor": "Verify Account", "href": "https://phish.evil.example/login"}],
        )

    def test_list_items_and_breaks(self) -> None:
        parsed = parse_mime_message((FIXTURES / "02_html_only.eml").read_bytes(), "msg-02")
        text, urls = sanitize_html(parsed.html_parts[0])
        self.assertIn("- Cloud: $4,200", text)
        self.assertIn("- CI: $800", text)
        self.assertEqual(urls, [{"anchor": "Approve here", "href": "https://finance.corp.example/q4"}])

    def test_bare_urls_and_dedupe(self) -> None:
        plain = "Check https://jira.corp.example/browse/SEC-42 and mailto:help@corp.example."
        bare = extract_bare_urls(plain)
        self.assertEqual(
            bare,
            [{"anchor": "https://jira.corp.example/browse/SEC-42", "href": "https://jira.corp.example/browse/SEC-42"}],
        )
        merged = merge_urls(
            [{"anchor": "SEC-42", "href": "https://jira.corp.example/browse/SEC-42"}],
            bare,
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["anchor"], "SEC-42")


if __name__ == "__main__":
    unittest.main()
