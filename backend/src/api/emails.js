// Emails (§6.5): list, detail, per-person state, label correction (FR-ML-010/013), .ics (FR-ORC-017).
import { Router } from 'express';
import { Fail, idParam, isDateTime, object, own, pageParams, route, searchParams, toPage } from '../http.js';
import { query, tx } from '../services/db.js';
import { SENTIMENTS, TYPES, URGENCIES, detail, list, listItem } from '../services/emails.js';
import { publish } from '../services/events.js';

export const emails = Router();
const LABELS = { email_type: TYPES, urgency: URGENCIES, sentiment: SENTIMENTS };

route(emails, 'get', '/emails', 'user', async (req, user) => {
  const params = searchParams(req);
  const p = pageParams(params);
  return toPage(await list(user.id, params, p), p);
});

route(emails, 'get', '/emails/:id', 'user', async (req, user) => own(await detail(user.id, idParam(req, 'Email')), 'Email'));

// PATCH /emails/:id: pinned and snoozed_until (§6.5 v1.1), handled and read (PROPOSED §10.3, §12.3). All of it is
// the caller's own state (email_user_state), never visible to other recipients.
route(emails, 'patch', '/emails/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Email');
  own(await listItem(user.id, id), 'Email');
  const f = object(req.body).only(['pinned', 'snoozed_until', 'handled', 'read']);
  for (const k of ['pinned', 'handled', 'read']) if (k in f.body && typeof f.body[k] !== 'boolean') f.add(k, 'Must be true or false');
  if ('snoozed_until' in f.body && f.body.snoozed_until !== null && !isDateTime(f.body.snoozed_until)) f.add('snoozed_until', 'Must be an ISO date-time or null');
  f.done();
  const b = f.body;
  const args = [user.id, id];
  const arg = (v) => (args.push(v), `$${args.length}`);
  // A true keeps the first time it was set; a false clears it.
  const stamp = (k, col) => `${col} = CASE WHEN ${arg(b[k])}::boolean THEN coalesce(email_user_state.${col}, now()) ELSE NULL END`;
  const sets = [
    'pinned' in b && stamp('pinned', 'pinned_at'),
    'handled' in b && stamp('handled', 'handled_at'),
    'read' in b && stamp('read', 'read_at'),
    'snoozed_until' in b && `snoozed_until = ${arg(b.snoozed_until)}::timestamptz`,
  ].filter(Boolean);
  if (sets.length) {
    await query('INSERT INTO email_user_state (user_id, email_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, id]);
    await query(`UPDATE email_user_state SET ${sets.join(', ')} WHERE user_id = $1 AND email_id = $2`, args);
  }
  const d = await detail(user.id, id);
  publish(user.id, 'email.triaged', { email_id: id, email: await listItem(user.id, id) });
  return d;
});

route(emails, 'patch', '/emails/:id/labels', 'user', async (req, user) => {
  const id = idParam(req, 'Email');
  const item = own(await listItem(user.id, id), 'Email');
  const f = object(req.body).only(['field', 'value', 'scope']);
  const { field, value } = f.body;
  const scope = f.body.scope ?? 'email';
  if (!(field in LABELS)) f.add('field', 'Must be email_type, urgency or sentiment');
  else if (!LABELS[field].includes(value)) f.add('value', `Not a valid ${field}`);
  if (!['email', 'sender', 'similar'].includes(scope)) f.add('scope', 'Must be email, sender or similar');
  f.done();
  if (!item.triage) throw new Fail(409, 'conflict', 'Email is not triaged yet');

  const result = await tx(async (c) => {
    const correction = (await c.query(
      'INSERT INTO label_corrections (email_id, user_id, field, old_label, new_label) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [id, user.id, field, item.triage[field].label, value],
    )).rows[0];
    // triage_results is the source of truth; its trigger keeps the copy on emails in step.
    const col = { email_type: 'email_type', urgency: 'urgency', sentiment: 'sentiment' }[field];
    await c.query(`UPDATE triage_results SET ${col} = $2, needs_review = false${field === 'email_type' ? ", type_source = 'user'" : ''} WHERE email_id = $1`, [id, value]);
    // FR-ML-013 "Always from this sender": a personal rule for this user only, never the shared model (FR-ML-015).
    let ruleId = null;
    if (scope === 'sender') {
      ruleId = (await c.query(
        `INSERT INTO user_label_rules (tenant_id, user_id, field, sender, label) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, field, sender) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
        [user.tenant_id, user.id, field, item.from.address.toLowerCase(), value],
      )).rows[0].id;
    }
    return { correctionId: correction.id, ruleId };
  });
  const updated = await listItem(user.id, id);
  publish(user.id, 'email.triaged', { email_id: id, email: updated });
  return { triage: updated.triage, correction_id: result.correctionId, rule_id: result.ruleId };
});

/** RFC 5545 text escaping, so email-derived text can't inject calendar properties. */
const icsText = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

route(emails, 'get', '/emails/:id/ics', 'user', async (req, user, res) => {
  const id = idParam(req, 'Email');
  const item = own(await listItem(user.id, id), 'Email');
  const p = (await query(`SELECT payload FROM actions WHERE email_id = $1 AND user_id = $2 AND type = 'add_calendar_event' ORDER BY created_at LIMIT 1`, [id, user.id])).rows[0]?.payload;
  if (item.triage?.email_type.label !== 'Meeting' || !p?.start || !p.end) throw new Fail(404, 'not_found', 'No meeting time for this email');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SECEP//EN', 'BEGIN:VEVENT',
    `UID:${id}@secep`, `DTSTAMP:${icsDate(new Date().toISOString())}`, `DTSTART:${icsDate(p.start)}`, `DTEND:${icsDate(p.end)}`,
    `SUMMARY:${icsText(p.title ?? item.subject ?? 'Meeting')}`,
    ...(p.description ? [`DESCRIPTION:${icsText(p.description)}`] : []),
    ...(p.attendees ?? []).map((a) => `ATTENDEE:mailto:${a}`),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="meeting.ics"', 'X-Content-Type-Options': 'nosniff' });
  res.send(lines.join('\r\n') + '\r\n');
}, { raw: true });
