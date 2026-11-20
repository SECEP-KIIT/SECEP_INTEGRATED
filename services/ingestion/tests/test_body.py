"""Tests for canonical body selection and ML text derivation (FR-ING-007, FR-ING-008)."""
from __future__ import annotations

import unittest
from pathlib import Path

from ingestion.body import build_bodies_and_urls
from ingestion.mime_parser import parse_mime_message

FIXTURES = Path(__file__).parent / "fixtures"


class TestBody(unittest.TestCase):
    def test_multipart_alternative_picks_larger_normalized_body(self) -> None:
        parsed = parse_mime_message((FIXTURES / "03_multipart_alt.eml").read_bytes(), "msg-03")
        body_text, ml_text, urls, secrets = build_bodies_and_urls(parsed)
        self.assertIn("Detailed HTML deployment plan", body_text)
        self.assertIn("Detailed HTML deployment plan", ml_text)
        self.assertEqual(urls[0]["href"], "https://docs.corp.example/deploy")
        self.assertEqual(secrets, [])

    def test_reply_strips_quotes_in_ml_text_only(self) -> None:
        parsed = parse_mime_message((FIXTURES / "11_reply_quoted_sig.eml").read_bytes(), "msg-11")
        body_text, ml_text, _, _ = build_bodies_and_urls(parsed)
        # body_text keeps everything
        self.assertIn("Bob Smith", body_text)
        self.assertIn("Please review before 3pm", body_text)
        # ml_text removes the quoted reply. The signature is kept on purpose: common/text.py (what the encoder
        # was trained on) does not strip signatures, so stripping them here would cause train/serve skew.
        self.assertIn("Looks good, I will merge the PR today.", ml_text)
        self.assertNotIn("Please review before 3pm", ml_text)


if __name__ == "__main__":
    unittest.main()
