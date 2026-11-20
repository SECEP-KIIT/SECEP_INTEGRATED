# QA pass 3, commit 5: dark mode (3 Nov 2026)

New scope, recorded as a v1.3 addition (proposals §16.6). Frontend and mock only.

## What changed
- **Light / Dark / Auto:**
  - `ui_prefs.theme` (PROPOSED) through `PATCH /me/preferences`; the mock validates it (422 otherwise).
  - Auto follows `prefers-color-scheme` and switches live when the system does.
  - The lock controller applies `<html data-theme>`, next to `data-motion`, and mirrors the choice into the `secep.boot` boot preferences. A reload is dark before the app paints.
- **Dark tokens** (`tokens.css`, `html[data-theme='dark']`):
  - the sheet, columns, cards, chips, tags, drawer, popovers, sheets, menus and tiles;
  - `color-scheme: dark` for native controls and scrollbars;
  - a new `--accent-text` for the accent used as text (links, "See all"), lighter in dark mode;
  - accent fills keep white text at 5.67.
- **Contrast checked** (`tokens.css` comments):
  - text: ink 12.42, muted 7.15 on cards; tags 8.20 / 9.27 / 8.32; accent text 7.47;
  - marks: urgency marks 4.94–7.97, sentiment 5.85–8.20, focus 7.47, strong edges 3.44.
  - Every text pair passes 4.5 and every mark, edge and focus pair passes 3.0.
- **Unchanged:** the lock screen, the wallpaper and the frosted bars follow the wallpaper tone as before. The bar ink tokens are now literal, so the app theme can't recolour them.
- **Toggle:**
  - **Desktop and tablet:** the avatar row in the sidebar is now a small menu (name, email, Theme). It's in a portal, because the sidebar panel clips; Esc, a click outside or Tab closes it and returns focus to the avatar.
  - **Phone:** the same control is on the More page, since phones have no sidebar.
  - It's a radio group with an icon and a name per choice, so the choice is never colour alone.
  - The Settings page takes it over in task 16.

## Gate
- lint and typecheck clean.
- **168/168 tests**. New: `effectiveTheme`; `resolvePrefs` theme defaulting; `PATCH /me/preferences` theme (dark, auto, then 422 for "sepia").
- Build OK.
- `dist`: no mock code, one module script.
- **Headless Chrome:**
  - Dark from the avatar menu recolours the cards (#232838, ink #e9ecf5) and is mirrored; a reload boots dark;
  - Auto with a light system is light, and turning the system dark switches it live;
  - Esc closes the menu wherever focus is;
  - screenshots of the dashboard, the hover lift and the drawer look right, and the bars stay legible over the day wallpaper.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot, with the theme) | 3.18 | initial |
| main (avatar menu) | 79.65 | initial |
| queries (shared) | 14.95 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **100.92** | budget 200 |
| Dashboard | 24.42 | lazy |
| InboxHost | 48.02 | lazy |
| EmailDrawer | 6.99 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main (dark tokens) / InboxHost / Dashboard / drawer | 1.57 / 3.86 / 3.57 / 3.10 / 1.75 | — |

## Browser checks owed
1. **Avatar menu:**
   - click the avatar: name, email, Theme;
   - Light / Dark / Auto apply at once;
   - Esc, a click outside or Tab closes it;
   - with the sidebar collapsed, it isn't clipped.
2. **Auto:** with Auto, switch Windows between light and dark mode; the app follows without a reload.
3. **Reload in Dark:** the app is dark as the lock lifts, with no light flash.
4. **Every surface in Dark:**
   - dashboard tiles and swatch stripes; cards and the hover lift; chips and tags (security, due, sentiment);
   - urgency marks; the filter popover; the widget menu and gallery; the drawer and composer; toasts;
   - the phone sections, page switcher, edit sheet and long-press menu;
   - text is readable everywhere.
5. **Unchanged:** the lock screen and wallpaper look the same in both themes; the sidebar and topbar text is readable over every wallpaper phase.
6. **Phone:** More shows Theme; the choice syncs with desktop after a reload (same `ui_prefs`).
