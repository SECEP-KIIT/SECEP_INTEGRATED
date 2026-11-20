"""Regression tests for the 19 Nov 2026 review fixes (no database needed)."""
from __future__ import annotations

import unittest

from ingestion.body import build_bodies_and_urls
from ingestion.mime_parser import attach_gmail_attachment_ids, parse_mime_message
from secep_common.masking import mask


def _mixed(*parts: bytes) -> bytes:
    head = (
        b"From: a@x.com\r\nTo: bob@corp.example\r\nSubject: s\r\nMessage-ID: <t@x>\r\n"
        b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=M\r\n\r\n"
    )
    return head + b"".join(b"--M\r\n" + p + b"\r\n" for p in parts) + b"--M--\r\n"


def _pdf(name: bytes, b64: bytes) -> bytes:
    return (
        b"Content-Type: application/pdf; name=" + name + b"\r\nContent-Disposition: attachment; filename="
        + name + b"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64
    )


class TestAttachmentIds(unittest.TestCase):
    def test_ids_never_cross_match_by_position(self) -> None:
        # body + invoice + contract: Gmail partIds 0,1,2; our walk numbering differs. Must not swap files.
        raw = _mixed(b"Content-Type: text/plain\r\n\r\nSee attached.", _pdf(b"invoice.pdf", b"QUFBQQ=="),
                     _pdf(b"contract.pdf", b"QkJCQkJC"))
        p = parse_mime_message(raw, "m")
        gmail = {"partId": "", "parts": [
            {"partId": "0"},
            {"partId": "1", "filename": "invoice.pdf", "body": {"attachmentId": "ID_INVOICE", "size": 4}},
            {"partId": "2", "filename": "contract.pdf", "body": {"attachmentId": "ID_CONTRACT", "size": 6}},
        ]}
        attach_gmail_attachment_ids(p.attachments, gmail)
        self.assertEqual({a.filename: a.attachment_id for a in p.attachments},
                         {"invoice.pdf": "ID_INVOICE", "contract.pdf": "ID_CONTRACT"})

    def test_same_name_and_size_paired_in_order(self) -> None:
        raw = _mixed(b"Content-Type: text/plain\r\n\r\nTwo scans.", _pdf(b"scan.pdf", b"QUFBQQ=="),
                     _pdf(b"scan.pdf", b"QkJCQg=="))
        p = parse_mime_message(raw, "m")
        gmail = {"parts": [
            {"partId": "1", "filename": "scan.pdf", "body": {"attachmentId": "FIRST", "size": 4}},
            {"partId": "2", "filename": "scan.pdf", "body": {"attachmentId": "SECOND", "size": 4}},
        ]}
        attach_gmail_attachment_ids(p.attachments, gmail)
        self.assertEqual([a.attachment_id for a in p.attachments], ["FIRST", "SECOND"])

    def test_unmatched_stays_null(self) -> None:
        raw = _mixed(b"Content-Type: text/plain\r\n\r\nx", _pdf(b"a.pdf", b"QUFBQQ=="))
        p = parse_mime_message(raw, "m")
        attach_gmail_attachment_ids(p.attachments, {"parts": [
            {"filename": "other.pdf", "body": {"attachmentId": "X", "size": 4}}]})
        self.assertIsNone(p.attachments[0].attachment_id)


class TestAttachedMessage(unittest.TestCase):
    def test_forwarded_eml_is_an_attachment_not_body(self) -> None:
        raw = _mixed(
            b"Content-Type: text/plain\r\n\r\nFYI, see the attached old thread.",
            b"Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename=old.eml\r\n\r\n"
            b"From: z@y.com\r\nSubject: old\r\n\r\nURGENT: wire 50,000 USD by Friday.",
        )
        p = parse_mime_message(raw, "m")
        body_text, ml_text, _, _ = build_bodies_and_urls(p)
        self.assertEqual([(a.filename, a.mime) for a in p.attachments], [("old.eml", "message/rfc822")])
        self.assertNotIn("wire 50,000", body_text)
        self.assertNotIn("wire 50,000", ml_text)


class TestPasswordMasking(unittest.TestCase):
    def test_real_passwords_masked(self) -> None:
        for t in ["Your temporary password: hunter", "password is Summer2024!", "pwd=letmein",
                  "pass: hunter2", "Your password is: Xy7#kq", "The passcode: tiger"]:
            self.assertIn("[MASKED:password]", mask(t)[0], t)

    def test_prose_not_masked(self) -> None:
        for t in ["Your password is changing next week.", "Please pass - the ball is in your court.",
                  "Boarding pass: Gate 5"]:
            self.assertEqual(mask(t)[0], t)


if __name__ == "__main__":
    unittest.main()
