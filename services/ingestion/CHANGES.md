# Changes after review (19 Nov 2026)

Gemini's first build passed its own 26 tests, but those used stand-ins for PostgreSQL and Redis. Run against a
real PostgreSQL 16 (migrations 001 + 004) and real Redis, it stored nothing. These are the fixes.

| # | Problem | Fix | File |
|---|---|---|---|
| 1 | **Deadlock on the first email.** The poll held the mailbox row with `FOR UPDATE`, then inserted a thread on a second connection; the thread's foreign-key check needs a lock on that same row, so both waited forever. Nothing was stored, and `/health` still said "ok". | Row lock removed. The transaction-scoped advisory lock (`pg_try_advisory_xact_lock`) already keeps two workers off one mailbox. | `store.py` |
| 2 | **Wrong attachment served.** Attachments were matched to Gmail's `attachmentId` by part number, but local numbering (walk order, counting containers) differs from Gmail's (`0`, `1`, `0.1`). In "body + invoice.pdf + contract.pdf" both pointed at the contract. | Match by (filename, decoded size) only, paired in document order; unmatched stays `null`. | `mime_parser.py` |
| 3 | **Subject never masked.** "Your OTP is 482913" was stored, searched, embedded and sent to the LLM as written. | Subject is masked like the body; its secret types are recorded in `masked_secrets`. | `scheduler.py` |
| 4 | **One bad email stalled a mailbox.** An exception while cleaning a message aborted the whole poll before the checkpoint, so the same message failed every 30 s. | Each message is isolated: failures go to `emails.dlq` (class name only) and the poll continues. Postgres/Redis outages still abort the poll, so the checkpoint never moves past unrecorded mail. The store step had the same flaw for outages (it would dead-letter everything and advance) and is fixed too. | `scheduler.py` |
| 5 | **Fixture mode flooded the streams.** Every poll replayed every file; crash recovery re-sent each still-untriaged email (204 events for 51 emails in 20 s), and the malformed fixture was dead-lettered every cycle. | Fixture cursor `fx:<n>` in `mailboxes.history_id`; only new files are read. | `providers/fixtures.py` |
| 6 | **ML text skew.** `email-reply-parser` and an extra signature stripper ran before the `common/text.py` steps; training used `text.py` alone. | Only `split_quoted` → `normalise` → length cap. Signatures now stay in `ml_text`, as in training. (`body_text` is unchanged.) | `textprep.py` |
| 7 | Envelope `received_at` used the machine's time zone (`+05:30`). | Always UTC `Z`. | `store.py` |
| 8 | An attached email (`message/rfc822`, a forwarded `.eml`) was merged into the body, so an old thread was classified as the new message. | Listed as an attachment (metadata only); its text is not in the body. | `mime_parser.py` |
| 9 | Password rule masked prose ("password is **changing**", "boarding pass: **Gate** 5") and missed "password is: Xy7#kq". | After a weak cue ("is", "-", bare "pass") the value needs a digit or symbol; "is:" / "is =" accepted as separators. | `secep_common/masking.py` |
| 10 | Client secret read only from `GOOGLE_CLIENT_SECRET`. | `GOOGLE_CLIENT_SECRET_FILE` supported, as in the API. | `config.py` |
| 11 | `store_error` DLQ entries could echo row values from the database error text. | Class name only. | `scheduler.py` |
| 12 | Python pinned to 3.11 only; unused `google-auth`, `pydantic-settings`, `email-reply-parser` dependencies. | `>=3.11`; unused dependencies removed. | `pyproject.toml` |

## New tests
- `tests/test_review_fixes.py`: attachment-ID matching (cross-match, same name, unmatched), attached `.eml`,
  password masking both ways.
- `tests/test_live_pipeline.py` (real PostgreSQL + Redis, `RUN_LIVE_TESTS=1`): first poll finishes within 30 s
  and stores everything, UTC envelopes, `value_enc` always NULL; second poll adds and publishes nothing; subject
  secrets masked; poison message dead-lettered and checkpoint advanced; crash between commit and publish
  re-sends the envelope without duplicating the row. Against the original `store.py` the first test fails in 30 s
  with "did not finish (lock wait / deadlock)".

Result: 37 tests, all passing (1 old placeholder skipped). Encryption verified against the real
`backend/src/services/crypto.js` (hex key and passphrase fallback). The Docker image was not built (no Docker
daemon in the review environment); `pip install` of the package was verified.

## Known limits (unchanged, by design or for later)
- `textprep.py`'s `normalise()` / `split_quoted()` / `MAX_BODY_CHARS` were copied by Gemini from
  `ML_Training/common/text.py`; the reviewer did not have that file. Diff them once against the real file.
- No M3 (triage) consumer exists yet: ingested emails stay `status = 'ingested'` with no labels, and the API has
  no stream consumer, so new mail appears on a page refresh, not live.
