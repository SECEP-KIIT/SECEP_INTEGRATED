"""Tests for subject_norm, recipient_position, and synthetic thread IDs (C1)."""
from __future__ import annotations

import unittest

from ingestion.threading_ import compute_recipient_position, normalize_subject, synthetic_thread_id


class TestThreading(unittest.TestCase):
    def test_normalize_subject(self) -> None:
        self.assertEqual(
            normalize_subject("Re: Fwd: [URGENT]   AW:  Q4   Budget "),
            "q4 budget",
        )
        self.assertEqual(normalize_subject(None), "")

    def test_recipient_position_gmail_dots_and_plus_tags(self) -> None:
        self.assertEqual(
            compute_recipient_position(
                "alice.smith@gmail.com",
                ["alicesmith+work@gmail.com"],
                [],
            ),
            "to",
        )
        self.assertEqual(
            compute_recipient_position(
                "alice@corp.example",
                ["bob@corp.example"],
                ["alice+alerts@corp.example"],
            ),
            "cc",
        )
        self.assertEqual(
            compute_recipient_position(
                "alice@corp.example",
                ["list@corp.example"],
                [],
            ),
            "bcc",
        )

    def test_synthetic_thread_id_deterministic(self) -> None:
        t1 = synthetic_thread_id("weekly sync", ["bob@corp.example", "alice@corp.example"])
        t2 = synthetic_thread_id("weekly sync", ["alice@corp.example", "bob@corp.example"])
        self.assertEqual(t1, t2)
        self.assertTrue(t1.startswith("fx-"))


if __name__ == "__main__":
    unittest.main()
