# Task 15: security flows (18 Nov 2026), desktop

## Built
- **F5, sign-in and sign-out (NFR-SEC-003):**
  - With no session, at boot or after a failed refresh, the shell is replaced by a sign-in screen ("Sign in with Google" → `GET /api/v1/auth/google?return=…`).
  - The avatar menu gains **Sign out** (`POST /auth/logout`, the token is dropped).
  - `src/api/session.ts` holds the signed-out flag. Mock mode signs the demo user in on the spot; that branch is dev-only and is removed from production builds.
- **Reveal (FR-SEC-007/008):** the drawer lists each masked secret with **Reveal**.
  - `reauth_required` offers "Sign in again", then reveals.
  - The value shows with Copy, Hide and a "hides in N s" countdown from the server's `expires_in` (60 s), then is dropped.
  - The value is held only in component state: never in the query cache, storage or logs. The server audits the reveal without the value.
- **Security view (FR-SEC-003):** `/security` shows Malicious and Suspicious columns (full cards, drawer, banner, link checks). It needs `security.review`; otherwise it says so.
- **Links (FR-SEC-004):** the drawer's click-time check already does the interstitial (Open anyway for Suspicious, blocked for Malicious, with the redirect chain). Kept as is.

## Gate
- lint and typecheck clean; **175/175 tests** (new: refresh failure and sign-out mark the app signed out; reveal within 5 min, audited without the value, `reauth_required` after).
- Checked in headless Chromium: Reveal on an OTP email, the Security page, Sign out → sign-in screen → Sign in → app.

## Browser checks owed
1. Reveal, wait 60 s: the value disappears. Closing the drawer also drops it.
2. Dev panel: set the last sign-in to over 5 min ago, then Reveal → "Sign in again" → revealed.
3. A user without security.review: no Security nav item; `/security` shows the notice.
