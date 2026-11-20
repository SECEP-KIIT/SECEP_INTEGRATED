# Email Classifier (SECEP) — Claude Code briefing

SECEP reads a user's Gmail, classifies each email (type, urgency, sentiment), summarises it, proposes actions (Jira issue, board card, calendar event) and shows everything on a fast, tile-based web dashboard. KIIT B.Tech CSE 7th-semester major project; feature freeze 8 Nov 2026, submission 11 Nov 2026.

## Sources of truth (in this order)

1. `docs/SRS.md` — SRS **v1.1**. Requirements, priorities, API, schemas, database. If anything conflicts, the SRS wins.
2. `docs/frontend-decisions.md` — design detail for the dashboard (sizes, timings, visuals, rationale), items 1–15.
3. `docs/diagrams/` — UML diagrams (activity, class, sequence, use case).
4. `docs/archive/project-brief.md` — early brief, **outdated**. Do not follow it where it differs from the SRS.

Before building any feature: read the matching SRS section and decisions item first. Do not read the whole SRS every time — jump to the section you need.

## Repo layout vs. the SRS

The SRS (§6.2) names folders `web/` and `services/api/`. In this repo:

| SRS module | Folder here | Owner |
| --- | --- | --- |
| M8 Web dashboard | `frontend/` | me |
| M6 API & orchestrator | `backend/` | me |
| M0–M5, M7 (platform, ingestion, triage, decoder, security, data layer) | not in this repo yet | teammates |

Only work in `frontend/` and `backend/` unless asked.

## Stack (SRS §6.2) — do not add libraries outside this list without asking

- **frontend/**: React 18, TypeScript, Vite, vite-plugin-pwa, React Router, TanStack Query, TanStack Virtual, socket.io-client, dnd-kit, react-grid-layout, Radix UI, Framer Motion (via `LazyMotion` + `m`), Lucide icons, suncalc. Mock API: MSW.
- **backend/**: Node.js 20, Express, Socket.io, pg, ioredis, ajv, zod, jsonwebtoken, google-auth-library, web-push, sharp, busboy. Migrations: dbmate. Database: PostgreSQL 16 + pgvector + pg_trgm; Redis 7.2.

## Contracts are fixed

- JSON schemas: SRS §6.4. REST + WebSocket API: SRS §6.5. Database: SRS §6.6 (`001_init.sql` + `003_v1_1_addendum.sql`). Config keys: SRS §6.8.
- Never invent endpoints, fields or tables. If something is missing, stop and propose the SRS change first.
- Until a backend route exists, the frontend uses **MSW mocks** that return exactly the §6.4–6.5 shapes. Switching to the real API must need no component changes.

## Priorities

- Build **M** (Must) requirements first, then **S** (Should). Never build **F** (Future).
- Frontend Must items: SRS §3.4 (FR-ORC-001, 007, 008), §3.8–3.11 items marked M, FR-SEC-003/004/008 UI.

## Frontend rules (non-negotiable)

- Fast and lightweight: initial JS ≤ 200 KB gzipped (NFR-PERF-010); code-split widgets and heavy features; virtualise long lists.
- No layout shift: cards never change height on hover or live updates (NFR-PERF-011). New cards → "↑ n new" pill, never insert under the cursor.
- Animate only `transform` and `opacity`; honour `prefers-reduced-motion`.
- Render email bodies as **plain text only**. Never use `dangerouslySetInnerHTML` for email content. Every link goes through `/api/v1/links/{checkId}/go`.
- Colour never carries meaning alone (icons/shapes too).
- Access token in memory only; refresh via httpOnly cookie. Nothing secret in localStorage.

## Backend rules (non-negotiable)

- Deny by default: every route checks role/permission (RBAC matrix, SRS §4.3) — 403 otherwise.
- Validate every request and payload (zod for requests, ajv against `shared/schemas` / §6.4).
- Secrets encrypted with AES-256-GCM in the shared format (SRS §6.6). Never log email bodies, summaries, notes, event content or secrets.
- Jira/Google calls: honour 429 + Retry-After; idempotent actions (one issue per action).

## How to work

- Plan before code for anything bigger than a small fix; wait for approval.
- One feature per change; small commits with clear messages.
- Before saying "done": run typecheck, lint (oxlint) and tests, and the build for frontend changes. Check `package.json` scripts for the exact commands.
- If a requirement is unclear, ask — don't guess.

## Environment

- Windows, PowerShell, Node via npm.
- Never commit `.env` files; update `.env.example` when adding config keys (SRS §6.8).