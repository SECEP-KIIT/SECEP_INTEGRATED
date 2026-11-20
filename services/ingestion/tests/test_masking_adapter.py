"""Tests for credential masking adapter (C5)."""
from __future__ import annotations

import unittest
from pathlib import Path

from ingestion.body import build_bodies_and_urls
from ingestion.masking_adapter import mask_text, mask_urls
from ingestion.mime_parser import parse_mime_message

FIXTURES = Path(__file__).parent / "fixtures"


class TestMaskingAdapter(unittest.TestCase):
    def test_all_seven_c5_secret_types(self) -> None:
        cases = [
            ("12_secret_password.eml", "password", "Sup3rS3cretPass!99"),
            ("13_secret_api_key.eml", "api_key", "sk-test-AbCdEf1234567890XyZ"),
            ("14_secret_aws_key.eml", "aws_key", "AKIAIOSFODNN7EXAMPLE"),
            ("15_secret_private_key.eml", "private_key", "MIIBOgIBAAJBALeFakeKeyMaterial"),
            ("16_secret_jwt.eml", "jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
            ("17_secret_otp.eml", "otp", "849201"),
            ("18_secret_card.eml", "card", "4111-1111-1111-1111"),
        ]
        for fname, expected_type, raw_secret in cases:
            parsed = parse_mime_message((FIXTURES / fname).read_bytes(), fname)
            body_text, ml_text, _, secret_types = build_bodies_and_urls(parsed)
            self.assertIn(expected_type, secret_types, msg=f"Missing {expected_type} in {fname}")
            self.assertIn(f"[MASKED:{expected_type}]", body_text)
            self.assertIn(f"[MASKED:{expected_type}]", ml_text)
            self.assertNotIn(raw_secret, body_text)
            self.assertNotIn(raw_secret, ml_text)

    def test_urls_keep_href_unmasked_while_masking_anchor(self) -> None:
        urls = [{"anchor": "Use password: mySecret123", "href": "https://auth.example/login?tok=AKIAIOSFODNN7EXAMPLE"}]
        out = mask_urls(urls)
        self.assertEqual(out[0]["href"], "https://auth.example/login?tok=AKIAIOSFODNN7EXAMPLE")
        self.assertIn("[MASKED:password]", out[0]["anchor"])
        self.assertNotIn("mySecret123", out[0]["anchor"])

    def test_non_luhn_numbers_not_masked(self) -> None:
        masked, types = mask_text("Order ID 1234567890123456 is ready.")
        self.assertEqual(types, [])
        self.assertIn("1234567890123456", masked)


if __name__ == "__main__":
    unittest.main()
