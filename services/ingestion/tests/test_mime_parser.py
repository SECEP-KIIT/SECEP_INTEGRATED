"""Tests for MIME parsing, decoding, attachments, auth_results, and Message-ID fallback."""
from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

from ingestion.mime_parser import attach_gmail_attachment_ids, parse_mime_message

FIXTURES = Path(__file__).parent / "fixtures"


class TestMimeParser(unittest.TestCase):
    def test_plain_and_auth_results_prefers_google(self) -> None:
        raw = (FIXTURES / "01_plain.eml").read_bytes()
        parsed = parse_mime_message(raw, "msg-01")
        self.assertEqual(parsed.message_id_hdr, "<01@secep.example>")
        self.assertEqual(parsed.from_addr, "alice@corp.example")
        self.assertEqual(parsed.from_name, "Alice")
        self.assertEqual(parsed.to_addrs, ["bob@corp.example"])
        self.assertEqual(parsed.auth_results, {"spf": "pass", "dkim": "pass", "dmarc": "pass"})
        self.assertEqual(len(parsed.plain_parts), 1)

    def test_nested_mixed_attachments_sha256_and_attachment_id_match(self) -> None:
        raw = (FIXTURES / "04_nested_mixed_attachments.eml").read_bytes()
        parsed = parse_mime_message(raw, "msg-04")
        self.assertEqual(len(parsed.attachments), 1)
        att = parsed.attachments[0]
        self.assertEqual(att.filename, "spec.pdf")
        self.assertEqual(att.mime, "application/pdf")
        expected_bytes = b"%PDF-1.4\n%fake-pdf-content-for-secep-test\n"
        self.assertEqual(att.size, len(expected_bytes))
        self.assertEqual(att.sha256, hashlib.sha256(expected_bytes).hexdigest())
        self.assertIsNone(att.attachment_id)

        payload = {
            "parts": [
                {"partId": "0", "mimeType": "multipart/alternative"},
                {
                    "partId": "1",
                    "filename": "spec.pdf",
                    "body": {"size": len(expected_bytes), "attachmentId": "ANGjdJ-test-att-id"},
                },
            ]
        }
        attach_gmail_attachment_ids(parsed.attachments, payload)
        self.assertEqual(att.attachment_id, "ANGjdJ-test-att-id")

    def test_base64_and_quoted_printable_and_rfc2047(self) -> None:
        b64_parsed = parse_mime_message((FIXTURES / "05_base64_body.eml").read_bytes(), "msg-05")
        self.assertIn("all systems green", b64_parsed.plain_parts[0])

        qp_parsed = parse_mime_message((FIXTURES / "06_quoted_printable.eml").read_bytes(), "msg-06")
        self.assertIn("Café", qp_parsed.subject)
        self.assertIn("résumé", qp_parsed.plain_parts[0])

        rfc_parsed = parse_mime_message((FIXTURES / "07_rfc2047_subject.eml").read_bytes(), "msg-07")
        self.assertEqual(rfc_parsed.from_name, "Jürgen")
        self.assertIn("überfluss", rfc_parsed.subject)

    def test_non_utf8_and_invalid_charset(self) -> None:
        latin1 = parse_mime_message((FIXTURES / "08_non_utf8_latin1.eml").read_bytes(), "msg-08")
        self.assertIn("résumé", latin1.plain_parts[0])

        bogus = parse_mime_message((FIXTURES / "09_invalid_charset.eml").read_bytes(), "msg-09")
        self.assertIn("Fallback text", bogus.plain_parts[0])

    def test_calendar_invite_and_missing_message_id(self) -> None:
        cal = parse_mime_message((FIXTURES / "19_calendar_invite.eml").read_bytes(), "msg-19")
        self.assertEqual(len(cal.calendar_parts), 1)
        self.assertEqual(cal.attachments[0].mime, "text/calendar")

        missing_id = parse_mime_message((FIXTURES / "20_missing_message_id.eml").read_bytes(), "gmail-xyz")
        self.assertEqual(missing_id.message_id_hdr, "<gmail-gmail-xyz@secep.local>")

    def test_malformed_raises(self) -> None:
        raw = (FIXTURES / "21_malformed_dlq.eml").read_bytes()
        with self.assertRaises(ValueError):
            parse_mime_message(raw, "msg-21")


if __name__ == "__main__":
    unittest.main()
