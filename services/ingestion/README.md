# SECEP Email Ingestion Service (M2)

Polls connected Gmail mailboxes (or replays `.eml` fixtures), parses and sanitizes MIME messages, masks credentials, writes threads/emails/masked secret types to PostgreSQL 16, and publishes `envelope.v1` events to Redis Streams (`emails.ingested` / `emails.dlq`).

## Environment Variables

| Variable | Example | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://secep:secep@postgres:5432/secep` | PostgreSQL 16 DSN |
| `REDIS_URL` | `redis://redis:6379/0` | Redis 7.2 URL |
| `GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` | OAuth2 client ID (same as M6 API) |
| `GOOGLE_CLIENT_SECRET` or `GOOGLE_CLIENT_SECRET_FILE` | `...` | OAuth2 client secret; `_FILE` wins (same convention as the API) |
| `MASTER_KEY_FILE` | `/run/secrets/master_key` | **The same file the API uses** (`backend/secrets/master_key`); hex/base64/passphrase text (C4) |
| `POLL_INTERVAL_S` | `30` | Poll interval per cycle |
| `MAX_RAW_MB` | `50` | Max raw message size before DLQ |
| `INGEST_SOURCE` | `gmail` or `fixtures` | Source mode |
| `FIXTURES_DIR` | `/fixtures` | `.eml` directory (`fixtures` mode) |
| `FIXTURE_MAILBOX_ID` | `uuid` | Target mailbox UUID (`fixtures` mode) |
| `MAILBOX_IDS` | `uuid1,uuid2` | Optional comma-separated allow-list (`gmail` mode) |
| `HEALTH_PORT` | `8004` | HTTP `/health` port |
| `LOG_LEVEL` | `INFO` | Python log level |

## Running Locally

```bash
export PYTHONPATH=../../shared/python:.
python -m ingestion.main
```

## Fixture Mode (Demo / CI)

Set `INGEST_SOURCE=fixtures`, `FIXTURES_DIR=./tests/fixtures`, and `FIXTURE_MAILBOX_ID=<uuid>` to replay `.eml` files without OAuth or Gmail API calls.

Each file is ingested once. The cursor is stored in `mailboxes.history_id` as `fx:<n>` (the first n files, in
sorted-name order, are done). Drop a new file whose name sorts last (e.g. `60_new.eml`) and the next poll picks
it up. To replay the whole folder, set that mailbox's `history_id` to NULL.

## Running Tests

```bash
# Linux/macOS (Windows PowerShell: $env:PYTHONPATH = "..\..\shared\python;." — note the ';')
PYTHONPATH=../../shared/python:. python -m unittest discover -s tests -v
```

`tests/test_live_pipeline.py` runs the real pipeline against a real PostgreSQL 16 (with migrations 001 and 004)
and a real Redis. It is skipped unless you set `RUN_LIVE_TESTS=1`, `DATABASE_URL` and `REDIS_URL`. It creates and
deletes its own tenant, user and mailbox. Run it before every merge: mocks cannot show lock waits.

## Docker Compose Snippet

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: secep
      POSTGRES_PASSWORD: secep
      POSTGRES_DB: secep
    ports:
      - "5432:5432"

  redis:
    image: redis:7.2-alpine
    ports:
      - "6379:6379"

  ingestion:
    build:
      context: ../..
      dockerfile: services/ingestion/Dockerfile
    environment:
      DATABASE_URL: postgres://secep:secep@postgres:5432/secep
      REDIS_URL: redis://redis:6379/0
      INGEST_SOURCE: fixtures
      FIXTURES_DIR: /app/fixtures
      FIXTURE_MAILBOX_ID: "00000000-0000-0000-0000-000000000001"
      HEALTH_PORT: "8004"
    ports:
      - "8004:8004"
    depends_on:
      - postgres
      - redis
```
