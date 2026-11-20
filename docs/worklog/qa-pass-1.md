# QA pass 1 (browser checks for tasks 4–6), 2 Nov 2026

## Commit A: Dev panel idle-lock control

- **What:** an "Idle lock: 1 min · 15 min · off" row in the dev panel (Ctrl+Shift+D). It sends the real `PATCH /me/preferences { idle_minutes }`, then writes the response into the `/me` cache, so the shell passes it to `lock.configure` exactly as Settings will (task 16).
- **Dev-only:** the dev panel loads only through the `import.meta.env.DEV && VITE_MOCK === '1'` dynamic import. The main chunk's hash is unchanged, and `dist` has no dev-panel strings.
- **Browser re-verification:** none needed; the user tested it in the QA pass.

## Commit B: Task-4 shell polish (F1–F4)

- **F1, sidebar edge line.**
  - **Cause:** the orange line is the ambient Critical-unread glow (FR-UI-005), not a project indicator. It was positioned at `right: 0` of the 64 px sidebar column. During hover-peek the panel is revealed to 220 px by `clip-path`, but the glow stayed at 64 px and cut across the open panel.
  - **Fix:** while peeking, the glow moves out by `translateX(220 − 64 px)` with the same duration and easing as the clip-path reveal. Transform only.
- **F2, progress shown as solid dots.**
  - **Not deliberate; a task-4 bug.** The ring sat at the right end of the row and was hidden (opacity 0) whenever the sidebar was collapsed, and its track was a 6 % tint. So in the usual collapsed state you only ever saw the solid colour dot.
  - **Fix:** one marker in the icon column: the colour dot inside a 22 px ring. The arc is done/total in the project colour, and the track is a visible faint circle. It shows collapsed, peeking and expanded alike. `aria-label` reads "n of m done".
- **F3, bell and + below the topbar at ≤ 360 px.**
  - **Cause:** the phone topbar grid had two columns (`1fr auto`) for three zones, so the right zone wrapped onto an implicit second row, outside the 56 px bar.
  - **Fix:** `minmax(0, 1fr) auto auto`, with tighter gap and padding. The title truncates; search, bell and + keep their size.
- **F4, lock "done" state.**
  - New lock view `done` (`lock-state.ts`). When boot finishes while the Loading box is showing (the user clicked or pressed a key early), the ring closes in green and a green tick replaces "Loading". The tick is drawn by SVG stroke in 180 ms, the same exception as the item 9 Jira check, and instant under Reduced/Off motion. After `DONE_HOLD_MS` = 400 ms the lock releases. Screen readers hear "SECEP is ready".
  - Clicks, keys, idle and auto events during the tick change nothing.
  - If nothing was shown loading (ready before the click, or auto-enter on phones / skip lock), there is no tick: entering stays immediate, since there is nothing to confirm.
  - **Sheet slide confirmed as intended:** task 4 planned the enter motion as the sheet rising `translateY(24px) → 0` with opacity over 250 ms ease-out, the lock fading over 250 ms, and the wallpaper settling (1.04 → 1, dim). The sequence is now spinner → green tick (400 ms) → lock fades and the sheet rises. Under Reduced/Off it's a 100 ms / instant cross-fade with no rise.
  - Tick colours: `#237a37` on light wallpaper tones, `#8ce99a` on dark. Not measured against every gradient phase; the tick isn't the only signal, since the status text and the opening follow it.

**Gate:** lint and typecheck clean; 119/119 tests (the FR-WP-003 lock test now covers waiting → done → release → open, events ignored during done, and a stray release); build OK.

**Sizes (gzip):**
- Boot `index` 2.96 KB (was 2.89). `main` 78.44 KB, shared 13.84 KB, `jsx-runtime` 2.72 KB, runtime 0.42 KB (all unchanged).
- **Initial JS 98.38 KB.**
- Lazy: Inbox 41.59 KB, socket.io-client 12.86 KB, More 0.45 KB, Placeholder 0.15 KB.
- CSS: lock 1.51 KB (was 1.38), main 3.26 KB (was 3.21), Inbox 2.70 KB.
- `dist`: no mock or dev-panel code; `secep.boot` only in the boot chunk; one module script, no inline script.

**Browser re-verification needed: all four.**
- **F1:** the glow travels with the peek and rests on the expanded edge; nothing cuts across the panel. Check with Critical unread, as an admin.
- **F2:** rings around the dots in collapsed, peek and expanded states; partly done projects show an arc.
- **F3:** at 360 px the bell and + stay inside the bar; the title truncates.
- **F4:** press a key during boot: Loading box → green tick about 0.4 s → sheet slides up, with no flash between. Also check that a key pressed after ready opens directly, and Reduced/Off motion.
