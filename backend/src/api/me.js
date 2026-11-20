// /me, preferences, glance, notifications, disconnect (projects: api/projects.js) (§6.5; preferences and glance PROPOSED for v1.3).
import { Router } from 'express';
import { Fail, UUID, isInt, object, pageParams, route, searchParams, toPage } from '../http.js';
import { query } from '../services/db.js';

export const me = Router();

export const toMe = (u) => ({
  id: u.id,
  email: u.email,
  display_name: u.display_name,
  role_category: u.role_category,
  is_admin: u.is_admin,
  permissions: u.permissions,
  mailbox: u.mb_address ? { address: u.mb_address, status: u.mb_status, last_polled_at: u.mb_last_polled_at?.toISOString() ?? null } : null,
  ui_prefs: u.ui_prefs,
});

// PROPOSED (proposals §28): pop-up rules, quiet hours, key binds. Same rules as frontend/src/lib/popupRules.ts and keybinds.ts.
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const LEVELS = ['all', 'medium', 'high', 'critical', 'none'];
const MOODS = ['off', 'frustrated', 'negative'];
const isRule = (v) => isObj(v) && Object.keys(v).length === 2 && LEVELS.includes(v.urgency) && MOODS.includes(v.sentiment);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY_IDS = ['search', 'search_alt', 'quick_add', 'focus', 'lock', 'next', 'prev', 'select', 'done', 'project', 'remind', 'jira'];
const COMBO = /^(Mod\+)?(Alt\+)?(Shift\+)?([^+]|[A-Z][A-Z0-9]{1,11})$/;

// PROPOSED (proposals §29): onboarding progress. Same rules as frontend/src/onboarding/onboarding.ts.
const CHECK_IDS = ['open_email', 'send_jira', 'quick_add', 'search', 'popup_rules', 'quiet_hours'];
const HINT_IDS = ['card_keys', 'remind'];
const idList = (x, ok) => x === undefined || (Array.isArray(x) && x.length <= 10 && x.every((i) => ok.includes(i)));
const isOnboarding = (v) =>
  isObj(v) &&
  Object.keys(v).every((k) => ['tour', 'tour_step', 'checklist_hidden', 'done', 'hints'].includes(k)) &&
  (v.tour === undefined || ['done', 'skipped', 'paused'].includes(v.tour)) &&
  (v.tour_step === undefined || (Number.isInteger(v.tour_step) && v.tour_step >= 0 && v.tour_step < 20)) &&
  (v.checklist_hidden === undefined || typeof v.checklist_hidden === 'boolean') &&
  idList(v.done, CHECK_IDS) &&
  idList(v.hints, HINT_IDS);

const PREF_CHECKS = {
  motion: (v) => v === null || ['full', 'reduced', 'off'].includes(v),
  skip_lock: (v) => typeof v === 'boolean',
  idle_minutes: (v) => v === null || isInt(v, 1, 240),
  glance_subjects: (v) => typeof v === 'boolean',
  sidebar_collapsed: (v) => typeof v === 'boolean',
  theme: (v) => ['light', 'dark', 'auto'].includes(v),
  popup_rules: (v) => isObj(v) && Object.keys(v).length === 3 && isRule(v.normal) && isRule(v.focus) && isRule(v.quiet),
  quiet_hours: (v) => v === null || (isObj(v) && Object.keys(v).length === 2 && HHMM.test(v.start) && HHMM.test(v.end)),
  onboarding: isOnboarding,
  keybinds: (v) => isObj(v) && Object.entries(v).every(([k, c]) => KEY_IDS.includes(k) && typeof c === 'string' && c.length <= 24 && COMBO.test(c)),
};

route(me, 'get', '/me', 'user', (req, user) => toMe(user));

route(me, 'patch', '/me/preferences', 'user', async (req, user) => {
  const f = object(req.body);
  for (const [k, v] of Object.entries(f.body)) {
    if (!PREF_CHECKS[k]) f.add(k, 'Unknown preference');
    else if (!PREF_CHECKS[k](v)) f.add(k, 'Invalid value');
  }
  f.done('validation_failed', 'Invalid preferences');
  const { rows } = await query('UPDATE users SET ui_prefs = ui_prefs || $2 WHERE id = $1 RETURNING ui_prefs', [user.id, f.body]);
  return { ui_prefs: rows[0].ui_prefs };
});

// Lock-screen glance (FR-WP-001): counts only, unless the user opted into subjects.
route(me, 'get', '/me/glance', 'user', async (req, user) => {
  const details = user.ui_prefs.glance_subjects === true;
  const { rows: [c] } = await query(
    `WITH mine AS (
       SELECT e.id, e.urgency, e.subject, e.security_flag, s.read_at, s.handled_at
         FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id AND m.user_id = $1
         LEFT JOIN email_user_state s ON s.email_id = e.id AND s.user_id = $1),
     acts AS (SELECT * FROM actions WHERE user_id = $1 AND status <> 'rejected'),
     today AS (SELECT (now() AT TIME ZONE timezone)::date AS d FROM users WHERE id = $1)
     SELECT
       (SELECT count(*) FROM mine WHERE read_at IS NULL AND handled_at IS NULL)::int AS inbox_unread,
       (SELECT count(*) FROM mine WHERE read_at IS NULL AND handled_at IS NULL AND urgency = 'Critical')::int AS critical_unread,
       (SELECT count(*) FROM acts WHERE board_column = 'todo')::int AS board_todo,
       (SELECT count(*) FROM acts, today WHERE secep_try_date(payload->>'due_date') = today.d AND coalesce(board_column,'') <> 'done')::int AS due_today,
       (SELECT count(*) FROM acts, today WHERE secep_try_date(payload->>'due_date') < today.d AND coalesce(board_column,'') <> 'done')::int AS overdue,
       (SELECT count(*) FROM mine WHERE security_flag <> 'none')::int AS security_flags,
       (SELECT json_build_object('title', payload->>'title', 'start', payload->>'start') FROM acts
         WHERE secep_try_timestamptz(payload->>'start') > now() ORDER BY secep_try_timestamptz(payload->>'start') LIMIT 1) AS next_event,
       (SELECT coalesce(json_agg(coalesce(subject, '(no subject)')), '[]') FROM mine
         WHERE read_at IS NULL AND handled_at IS NULL AND urgency = 'Critical') AS subjects`,
    [user.id],
  );
  return {
    counts: {
      inbox_unread: c.inbox_unread,
      critical_unread: c.critical_unread,
      board_todo: c.board_todo,
      due_today: c.due_today,
      overdue: c.overdue,
      security_flags: user.permissions.includes('security.review') ? c.security_flags : null,
    },
    next_event: c.next_event ? { title: details ? c.next_event.title : null, start: c.next_event.start } : null,
    subjects: details ? c.subjects : null,
  };
});

route(me, 'get', '/notifications', 'user', async (req, user) => {
  const p = pageParams(searchParams(req));
  const { rows } = await query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3',
    [user.id, p.limit + 1, p.offset],
  );
  return toPage(rows.map((n) => ({
    id: n.id, kind: n.kind, title: n.payload.title, body: n.payload.body ?? null, target: n.payload.target ?? null,
    read_at: n.read_at?.toISOString() ?? null, created_at: n.created_at.toISOString(),
  })), p);
});

// §6.5 POST /notifications/read { ids? }: those, or every unread one when ids is left out. Another user's ids are ignored.
route(me, 'post', '/notifications/read', 'user', async (req, user) => {
  const f = object(req.body).only(['ids']);
  const ids = f.body.ids;
  if (ids !== undefined && !(Array.isArray(ids) && ids.length <= 500 && ids.every((i) => typeof i === 'string' && UUID.test(i)))) f.add('ids', 'Must be an array of notification ids');
  f.done();
  await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))',
    [user.id, ids ?? null],
  );
});

// FR-ADM-007: stop polling; M2 revokes the Google token when it sees the status.
route(me, 'delete', '/mailboxes/me', 'user', async (req, user) => {
  if (!user.mailbox_id) throw new Fail(404, 'not_found', 'No mailbox connected');
  await query("UPDATE mailboxes SET status = 'revoked' WHERE id = $1", [user.mailbox_id]);
});
