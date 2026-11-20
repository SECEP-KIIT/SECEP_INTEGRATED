# Task 10: board, projects, card drag (18 Nov 2026)

FR-ORC-007 (M), FR-UI-016/017/020/028 (S). Stacked on QA pass 5 (projects on the wire, proposals §18). No new wire changes.

## What's built
- **Board** (`/board`, and a **Board widget** in the gallery): To do · In progress · Done. Cards land in To do when a Jira issue or board card is created. Drag to move or reorder (dnd-kit). Keyboard: Space picks a card up, the arrows move it, Space drops it, Esc cancels. Moves persist (`PATCH /actions/:id`) and arrive live in other tabs. Clicking a card opens its email. Cards show type, Jira key, title and due date. Lanes are marked by shape as well as colour.
- **Project view** (`/projects/:id`): emoji, name, progress ring and "n of m tasks done", deadline countdown, Jira project and epic, description. The ring is **red** when the deadline is under 48 h away with under 70 % done, and **amber** when tasks are overdue. The warning is also written out. Sections: **Emails** (a full column scoped to the project) and **Tasks** (the board, this project's cards only). Notes, Files and Timeline join with tasks 12–13.
- **New / Edit project** dialog: name, colour, emoji, description, deadline, Jira project and epic, with 422 errors per field. Edit can **Archive** or **Restore** (archiving replaces deletion). Open it from the sidebar's **+**, from **New project…** in the Add-to-project picker (which then adds the chosen emails), or from a project's **Edit**.
- **Sidebar projects:** progress rings with the same red rule, **+**, archived projects folded under "Archived (n)". **Drag email cards onto a project** to add them (FR-UI-028); a selected card carries the selection, and the toast has Undo (Ctrl+Z too).
- A move on a project's board (only some cards) is turned into the user's global board position from the neighbouring card. `placeCard` mirrors M6's arithmetic, so the board stays exact before the server answers.

## Gate
- Frontend: lint and typecheck clean, **199/199 tests** (new: board order and moves on a project's partial board, positions, due and overdue, countdown, ring rules, the Board widget). Build OK; initial JS ≈ 103 KB gzipped (budget 200). The dialog is its own chunk; the board is 17.6 KB, lazy.
- Backend: 13/13 against PostgreSQL 16.
- Headless Chromium, **mock and real API** (`VITE_MOCK=0`, M6 on Postgres, no component changes):
  - board drag with mouse and keyboard, which persists after a reload; reorder; a card opens its email;
  - create a project (red ring with a deadline tomorrow); drag a card onto it in the sidebar, then see it on the project page;
  - Jira from a project's email puts a card in its Tasks, and Ctrl+Z takes it off;
  - "New project…" from the picker adds the email; the 422 shows on the field; Archive works;
  - Board widget added from the gallery.

## Not in this task
- FR-ORC-012 remainder: prefilling the Jira composer from the primary project needs `jira_project_key` / `jira_epic` in the action payload (proposals §11.2), which `enrich.v1` doesn't have yet.
- Dragging a board card onto a sidebar project, and the calendar drop (task 14).
- Phone board switcher (Version 2).
