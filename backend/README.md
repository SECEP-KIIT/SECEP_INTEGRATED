# SECEP backend (M6 — API & Orchestrator)

Node.js 20+ / Express 5 / Socket.io / PostgreSQL 16 (pgvector, pg_trgm). Implements the SRS §6.5 routes the
dashboard uses, with the §6.4.1 wire shapes, on M7's schema (`../db/migrations/001_init.sql`). The frontend
switches from its MSW mock to this API with no component changes.

## Run it (Windows, PowerShell)

1. **PostgreSQL 16 with pgvector.** Easiest with Docker:
   ```powershell
   docker run -d --name secep-db -p 5432:5432 -e POSTGRES_USER=secep -e POSTGRES_PASSWORD=secep -e POSTGRES_DB=secep pgvector/pgvector:pg16
   ```
2. **Install and configure:**
   ```powershell
   cd backend
   npm install
   Copy-Item .env.example .env
   mkdir secrets
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > secrets/master_key
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))" > secrets/jwt_secret
   ```
3. **Database and demo mailbox:** `npm run seed -- --fresh` (drops, migrates, seeds Northwind: 91 emails, 3 users).
4. **Start:** `npm run dev` (port 4000).
5. **Frontend on the real API:** in `frontend/.env.local` set `VITE_MOCK=0`, then `npm run dev`. Vite proxies `/api`
   (and the socket) to port 4000. "Sign in with Google" signs you in as `demo@northwind.example` while `DEV_LOGIN=1`
   and no Google client is configured.

## Scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | Start with auto-restart, loading `.env` |
| `npm start` | Start without `.env` (production: env vars from docker-compose) |
| `npm run migrate` | Apply `db/migrations/*.sql` (dbmate-compatible `schema_migrations`) |
| `npm run seed [-- --fresh]` | Seed the demo tenant from `seed/demo-mailbox.json` (`--fresh` drops everything first) |
| `npm test` | `node:test`; the API tests need `TEST_DATABASE_URL` (default `postgres://secep:secep@localhost:5432/secep_test`) and skip without it |
| `npm run lint` / `npm run check` | oxlint / `node --check` on every file |

## What's built (M6 core)
| Area | Routes |
| --- | --- |
| Auth (NFR-SEC-003, FR-ADM-001/004) | `GET /auth/google`, `/auth/google/callback`, `/auth/dev` (dev only), `POST /auth/refresh`, `/auth/logout` |
| Me | `GET /me`, `PATCH /me/preferences`, `GET /me/glance`, `GET /notifications`, `GET /projects`, `DELETE /mailboxes/me` |
| Emails | `GET /emails` (filters, views, due buckets, search, sorts, cursors), `GET/PATCH /emails/:id`, `PATCH /emails/:id/labels`, `GET /emails/:id/ics` |
| Actions | `GET /actions`, `POST /emails/:id/actions`, `POST /actions/:id/accept`, `/reject`, `/undo`, `PATCH /actions/:id` |
| Layouts | `GET/PUT /layouts/:deviceClass` (409 when stale, 422 with field errors, stacks) |
| Security | `POST /secrets/:id/reveal` (5-min re-auth, audited), `GET /links/:id/go` |
| Live | Socket.io `/api/socket.io`, namespace `/ws`: `email.triaged`, `action.updated` |

**Security:** deny by default (every route declares its access), owner checks answer 404, AES-256-GCM for stored
secrets, hash-chained append-only audit log, httpOnly SameSite=Strict refresh cookie, no bodies or secrets in logs.

**Not yet:** admin routes, Google Calendar writes (simulated), Jira status polling and comments, Redis Streams
consumers for M2–M5 events (the API publishes its own events until those services run), reminders, push, files.

## Layout
```
src/
  server.js      HTTP server + Socket.io
  app.js         Express app (imported by tests without opening a port)
  config.js      SRS §6.8 configuration; secrets from *_FILE
  http.js        route() with access rules, §6.4.1 errors, validation, cursor pages
  api/           route modules: auth, me, emails, actions, layouts, secrets
  services/      db, emails (list query + wire shapes), jira, events, tokens, crypto, audit, starters
scripts/         migrate, seed-demo, export-demo-seed (re-exports the mock's mailbox; needs `npx tsx`)
seed/            demo-mailbox.json
```
