// Layouts (FR-UI-010; PROPOSED shape, proposals §13, §16.3, §17). One per user and device class; PUT is a full
// replace checked against updated_at (409 when stale); over the caps or unknown fields is 422, never trimmed.
import { Router } from 'express';
import { Fail, UUID, isDateTime, isInt, object, route } from '../http.js';
import { query } from '../services/db.js';
import { filterError } from '../services/emails.js';
import { starterLayout } from '../services/starters.js';

export const layouts = Router();

const DEVICES = ['desktop', 'tablet', 'phone'];
const TYPES = ['inbox_column', 'board', 'projects', 'reminders', 'calendar', 'notes', 'stats', 'security'];
const SWATCHES = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'violet'];
const SORTS = ['smart', 'newest', 'oldest', 'due', 'urgency', 'sender', 'confidence'];
const DENSITIES = ['compact', 'comfortable', 'spacious'];
const SIZES = ['small', 'medium', 'large'];
const WIDGET_KEYS = ['id', 'type', 'size', 'hidden', 'stacked', 'title', 'colour', 'icon', 'filter', 'sort', 'density'];
const MAX_PAGES = 9;
const MAX_WIDGETS = 24;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const isEmoji = (v) => typeof v === 'string' && v.length <= 16 && [...segmenter.segment(v)].length === 1 && /\p{Extended_Pictographic}/u.test(v);
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function device(req) {
  if (!DEVICES.includes(req.params.deviceClass)) throw new Fail(400, 'bad_request', 'deviceClass must be desktop, tablet or phone');
  return req.params.deviceClass;
}

function checkWidget(f, at, w, ids) {
  if (!isRecord(w)) return f.add(at, 'Expected an object');
  for (const k of Object.keys(w)) if (!WIDGET_KEYS.includes(k)) f.add(`${at}.${k}`, 'Unknown field');
  for (const k of WIDGET_KEYS) if (!(k in w)) f.add(`${at}.${k}`, 'Required');
  if (typeof w.id !== 'string' || !UUID.test(w.id)) f.add(`${at}.id`, 'Must be a uuid');
  else if (ids.has(w.id)) f.add(`${at}.id`, 'Duplicate id');
  else ids.add(w.id);
  if (!TYPES.includes(w.type)) f.add(`${at}.type`, 'Unknown widget type');
  if (!SIZES.includes(w.size)) f.add(`${at}.size`, 'Must be small, medium or large');
  if (typeof w.hidden !== 'boolean') f.add(`${at}.hidden`, 'Must be true or false');
  if (typeof w.stacked !== 'boolean') f.add(`${at}.stacked`, 'Must be true or false');
  if (w.title !== null && !(typeof w.title === 'string' && w.title.trim().length >= 1 && w.title.length <= 60)) f.add(`${at}.title`, 'Must be 1–60 characters or null');
  if (w.colour !== null && !SWATCHES.includes(w.colour)) f.add(`${at}.colour`, `Must be one of ${SWATCHES.join(', ')} or null`);
  if (w.icon !== null && !isEmoji(w.icon)) f.add(`${at}.icon`, 'Must be one emoji or null');
  if (w.sort !== null && !SORTS.includes(w.sort)) f.add(`${at}.sort`, 'Unknown sort');
  if (w.density !== null && !DENSITIES.includes(w.density)) f.add(`${at}.density`, 'Unknown density');
  if (w.filter !== null) {
    if (w.type !== 'inbox_column') f.add(`${at}.filter`, 'Only inbox columns have a filter');
    else if (typeof w.filter !== 'string' || w.filter.length > 500) f.add(`${at}.filter`, 'Must be a query string');
    else {
      const err = filterError(w.filter);
      if (err) f.add(`${at}.filter`, err);
    }
  }
}

function checkPages(f, pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) return f.add('pages', `Must be 1–${MAX_PAGES} pages`);
  const ids = new Set();
  pages.forEach((p, i) => {
    const at = `pages.${i}`;
    if (!isRecord(p)) return f.add(at, 'Expected an object');
    for (const k of Object.keys(p)) if (!['id', 'name', 'order', 'widgets'].includes(k)) f.add(`${at}.${k}`, 'Unknown field');
    if (typeof p.id !== 'string' || !UUID.test(p.id)) f.add(`${at}.id`, 'Must be a uuid');
    else if (ids.has(p.id)) f.add(`${at}.id`, 'Duplicate id');
    else ids.add(p.id);
    if (!(typeof p.name === 'string' && p.name.trim().length >= 1 && p.name.length <= 40)) f.add(`${at}.name`, 'Must be 1–40 characters');
    if (!isInt(p.order, 0, MAX_PAGES - 1)) f.add(`${at}.order`, `Must be 0–${MAX_PAGES - 1}`);
    if (!Array.isArray(p.widgets) || p.widgets.length > MAX_WIDGETS) return f.add(`${at}.widgets`, `At most ${MAX_WIDGETS} widgets`);
    p.widgets.forEach((w, j) => checkWidget(f, `${at}.widgets.${j}`, w, ids));
    // F18 stacks: a stacked widget follows an unstacked one of the same size (at most two per slot).
    p.widgets.forEach((w, j) => {
      if (!isRecord(w) || w.stacked !== true) return;
      const prev = p.widgets[j - 1];
      if (!isRecord(prev) || prev.stacked !== false) f.add(`${at}.widgets.${j}.stacked`, 'A stacked widget must follow an unstacked one (at most two per slot)');
      else if (prev.size !== w.size) f.add(`${at}.widgets.${j}.size`, 'A stacked widget has the size of the widget it shares a slot with');
    });
  });
}

const respond = (dc, row) =>
  row ? { device_class: dc, pages: row.pages, updated_at: row.updated_at.toISOString(), is_default: false } : starterLayout(dc);

route(layouts, 'get', '/layouts/:deviceClass', 'user', async (req, user) => {
  const dc = device(req);
  const { rows } = await query('SELECT pages, updated_at FROM user_layouts WHERE user_id = $1 AND device_class = $2', [user.id, dc]);
  return respond(dc, rows[0]);
});

route(layouts, 'put', '/layouts/:deviceClass', 'user', async (req, user) => {
  const dc = device(req);
  const f = object(req.body).only(['pages', 'base_updated_at']);
  if (!('base_updated_at' in f.body) || (f.body.base_updated_at !== null && !isDateTime(f.body.base_updated_at))) {
    f.add('base_updated_at', 'Must be the updated_at the edit started from, or null');
  }
  checkPages(f, f.body.pages);
  f.done();
  const base = f.body.base_updated_at;
  // One statement: insert when there's none and the edit started from the default; otherwise update only if the
  // stored version is the one the edit started from. Microsecond timestamps, compared as instants.
  const { rows } = base === null
    ? await query(
        `INSERT INTO user_layouts (user_id, device_class, pages) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING pages, updated_at`,
        [user.id, dc, JSON.stringify(f.body.pages)],
      )
    : await query(
        `UPDATE user_layouts SET pages = $3, updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')
          WHERE user_id = $1 AND device_class = $2 AND date_trunc('milliseconds', updated_at) = $4::timestamptz RETURNING pages, updated_at`,
        [user.id, dc, JSON.stringify(f.body.pages), base],
      );
  if (!rows[0]) {
    const current = (await query('SELECT updated_at FROM user_layouts WHERE user_id = $1 AND device_class = $2', [user.id, dc])).rows[0];
    throw new Fail(409, 'conflict', 'The layout was changed somewhere else since this edit started', { updated_at: current?.updated_at.toISOString() ?? null });
  }
  return respond(dc, rows[0]);
});
