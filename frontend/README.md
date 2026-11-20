# SECEP frontend (M8 — Web dashboard)

React 18 + TypeScript + Vite. Requirements: SRS §3.4, §3.8–3.15 and §6.7 (M8); design detail in
`../docs/frontend-decisions.md`; wire shapes in SRS §6.4.1.

## Setup
```powershell
cd frontend
npm install
npm run dev
```

## Scripts
| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173 |
| `npm run build` | Typecheck and production build |
| `npm run typecheck` | `tsc -b` only |
| `npm run lint` | Lint with oxlint |
| `npm test` | Run tests with vitest |
| `npm run preview` | Serve the production build |

Before calling a change done, run `lint`, `typecheck`, `test` and `build`.

## API in development
The dev server proxies `/api` (including the Socket.io WebSocket at `/api/socket.io`) to the backend on
`http://localhost:4000`, so the app uses same-origin paths just as it does in production behind Caddy.
Until a backend route exists, MSW mocks return the §6.4.1 shapes: copy `.env.example` to `.env.local`
(`VITE_MOCK=1`) and restart `npm run dev`. Mocks are dev-only; production builds contain no MSW code or worker.

The mock (`src/mocks/`) is a stateful backend: a seeded store (~50 emails for the demo user), every Must route from
§6.5 with access checks and validation, a Socket.IO server on `/api/socket.io` (namespace `/ws`) driven by the real
`socket.io-client`, and simulated incoming mail. **Ctrl+Shift+D** opens the dev panel: send mail, run the §7.2 demo,
switch user (admin / user / reviewer), inject Jira failures, change latency, reset. `VITE_MOCK_PERSIST=1` keeps
what you change across reloads (versioned; fake secrets are never saved). `src/mocks/contract.test.ts` pins the
§6.4.1 shapes: M6 should pass the same expectations.

## Boot path (lock screen as the loader)
`index.html` holds the static lock screen and wallpaper (`src/boot/lock.css`) and loads exactly one script,
`src/boot/boot.ts`. That script fills the clock and wallpaper, then dynamically imports the app (`src/main.tsx`).
A build plugin (`preloadAppChunk` in `vite.config.ts`) adds `modulepreload` links, so the app chunk downloads in
parallel. The lock controller `src/boot/lock.ts` must exist as **one** module instance, shared by boot and app.

After `npm run build`, check:
```bash
grep -l "secep.boot" dist/assets/*.js                    # exactly one file: the boot entry chunk
grep -o '<script[^>]*>' dist/index.html | grep -v src=    # nothing: no inline scripts (CSP, NFR-SEC-008)
grep -rlE 'msw|mockServiceWorker|VITE_MOCK' dist          # nothing: mocks are dev-only
```
Targets: boot JS + lock CSS ≈ 5 KB gzipped; initial JS ≤ 200 KB gzipped (NFR-PERF-010).
