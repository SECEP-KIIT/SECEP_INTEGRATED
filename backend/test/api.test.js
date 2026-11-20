// M6 core against a real PostgreSQL (TEST_DATABASE_URL, default secep_test): migrated and seeded fresh, then the
// API is exercised over HTTP the way the frontend calls it. Skipped when the database isn't reachable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';

const DB = process.env.TEST_DATABASE_URL || 'postgres://secep:secep@localhost:5432/secep_test';
process.env.DATABASE_URL = DB;
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test';
process.env.MASTER_KEY ||= '0'.repeat(64);
process.env.DEV_LOGIN = '1';
process.env.FILES_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'secep-files-'));

const probe = new pg.Client({ connectionString: DB });
const reachable = await probe.connect().then(() => true, () => false);
await probe.end().catch(() => {});

describe('M6 API', { skip: !reachable && 'no test database' }, () => {
  let base;
  let server;
  let io;
  let cookie;
  let token;
  const api = async (path, init = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...init.headers },
      redirect: 'manual',
    });
    const json = res.headers.get('content-type')?.includes('application/json');
    return { status: res.status, body: json ? await res.json() : null, res };
  };

  before(async () => {
    execFileSync(process.execPath, ['scripts/seed-demo.js', '--fresh'], { env: process.env, stdio: 'ignore' });
    const { default: app } = await import('../src/app.js');
    const { attachSocket } = await import('../src/services/events.js');
    const { createServer } = await import('node:http');
    server = createServer(app);
    io = attachSocket(server);
    await new Promise((r) => server.listen(0, r));
    base = `http://localhost:${server.address().port}`;
  });
  after(async () => {
    io?.close();
    server?.closeAllConnections();
    server?.close();
    await (await import('../src/services/db.js')).pool.end();
  });

  test('sign-in: no cookie is 401; dev login sets an httpOnly refresh cookie; refresh gives a bearer token', async () => {
    assert.equal((await api('/auth/refresh', { method: 'POST' })).status, 401);
    assert.equal((await api('/me')).status, 401);
    const login = await api('/auth/dev?email=demo@northwind.example&return=/inbox');
    assert.equal(login.status, 302);
    assert.equal(login.res.headers.get('location'), '/inbox');
    const set = login.res.headers.get('set-cookie');
    assert.match(set, /HttpOnly/i);
    assert.match(set, /SameSite=Strict/i);
    cookie = set.split(';')[0];
    // Open redirect: an absolute return is ignored.
    assert.equal((await api('/auth/dev?return=//evil.example')).res.headers.get('location'), '/');
    const r = await api('/auth/refresh', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    token = r.body.access_token;
    const me = await api('/me');
    assert.equal(me.body.email, 'demo@northwind.example');
  });

  test('GET /emails: page shape, filters, 400/422 and pinned-first', async () => {
    const all = await api('/emails?limit=50');
    assert.ok(all.body.items.length > 20);
    const first = all.body.items[0];
    for (const k of ['id', 'from', 'triage', 'summary_one_line', 'handled', 'read', 'due_date', 'jira_key', 'reply_count']) assert.ok(k in first, k);
    const crit = await api('/emails?urgency=Critical&limit=50');
    assert.ok(crit.body.items.every((e) => e.triage.urgency.label === 'Critical'));
    assert.ok((await api('/emails?view=handled&limit=50')).body.items.every((e) => e.handled));
    assert.ok(all.body.items.every((e) => !e.handled));
    assert.equal((await api('/emails?type=Spam')).status, 400);
    assert.equal((await api('/emails?view=nope')).body.error.code, 'invalid_parameter');
    // Proposals §26: q_in=subject searches subjects only; other values are 422.
    const titled = all.body.items.find((e) => e.subject);
    const word = titled.subject.split(/\s+/).find((w) => w.length > 3) ?? titled.subject;
    const bySubject = await api(`/emails?q=${encodeURIComponent(word)}&q_in=subject&limit=50`);
    assert.ok(bySubject.body.items.some((e) => e.id === titled.id));
    assert.ok(bySubject.body.items.every((e) => (e.subject ?? '').toLowerCase().includes(word.toLowerCase())));
    assert.equal((await api('/emails?q=x&q_in=body')).status, 422);
    // Proposals §27: include_handled=true returns open and handled mail together.
    const handledCount = (await api('/emails?view=handled&limit=50')).body.items.length;
    const both = await api('/emails?include_handled=true&limit=50');
    assert.ok(both.body.items.some((e) => e.handled) === handledCount > 0);
    assert.equal((await api('/emails?include_handled=yes')).status, 422);
    const page1 = await api('/emails?limit=5');
    const page2 = await api(`/emails?limit=5&cursor=${encodeURIComponent(page1.body.next_cursor)}`);
    assert.equal(new Set([...page1.body.items, ...page2.body.items].map((e) => e.id)).size, 10);

    const pin = all.body.items.at(-1).id;
    assert.equal((await api(`/emails/${pin}`, { method: 'PATCH', body: JSON.stringify({ pinned: true, read: true }) })).body.pinned, true);
    assert.equal((await api('/emails?limit=50')).body.items[0].id, pin);
    assert.equal((await api(`/emails/${pin}`, { method: 'PATCH', body: JSON.stringify({ bogus: 1 }) })).status, 422);
    assert.equal((await api('/emails/not-a-uuid')).status, 404);
  });

  test('accept → one issue (idempotent) → undo deletes it → 409; the socket hears action.updated', async () => {
    const { io } = await import('socket.io-client');
    const socket = io(`${base}/ws`, { path: '/api/socket.io', transports: ['websocket'], auth: { token } });
    const heard = [];
    socket.on('action.updated', (p) => heard.push(p.action.id));
    await new Promise((r, j) => (socket.on('connect', r), socket.on('connect_error', j)));

    const items = (await api('/emails?limit=50')).body.items.filter((e) => e.proposed_action_count > 0);
    let action;
    for (const e of items) {
      action = (await api(`/emails/${e.id}`)).body.actions.find((a) => a.type === 'create_jira_issue' && a.status === 'proposed');
      if (action) break;
    }
    assert.ok(action, 'a proposed Jira action');
    const [a1, a2] = await Promise.all([api(`/actions/${action.id}/accept`, { method: 'POST', body: '{}' }), api(`/actions/${action.id}/accept`, { method: 'POST', body: '{}' })]);
    const ok = [a1, a2].filter((r) => r.status === 200);
    assert.ok(ok.length >= 1);
    assert.ok([a1, a2].every((r) => r.status === 200 || r.status === 409));
    const done = (await api(`/actions/${action.id}/accept`, { method: 'POST', body: '{}' })).body;
    assert.equal(done.status, 'done');
    assert.equal(done.board_column, 'todo');
    assert.ok(ok.every((r) => r.body.external_ref === done.external_ref), 'exactly one issue');

    const undone = await api(`/actions/${action.id}/undo`, { method: 'POST' });
    assert.equal(undone.body.status, 'proposed');
    assert.equal(undone.body.external_ref, null);
    assert.equal((await api(`/actions/${action.id}/undo`, { method: 'POST' })).status, 409);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(heard.includes(action.id));
    socket.close();
  });

  test('no reveal route; secrets list only types; open_url links the message in Gmail', async () => {
    const db = new pg.Client({ connectionString: DB });
    await db.connect();
    const { rows: [s] } = await db.query(`SELECT ms.id, ms.email_id FROM masked_secrets ms JOIN users u ON u.id = ms.owner_user_id WHERE u.email = 'demo@northwind.example' LIMIT 1`);
    assert.equal((await api(`/secrets/${s.id}/reveal`, { method: 'POST' })).status, 404);
    const d = (await api(`/emails/${s.email_id}`)).body;
    assert.deepEqual(Object.keys(d.masked_secrets[0]).sort(), ['id', 'secret_type']);
    assert.match(d.open_url, /^https:\/\/mail\.google\.com\/mail\/\?authuser=demo%40northwind\.example#all\//);
    // The audit log is append-only (NFR-SEC-006).
    await assert.rejects(db.query('UPDATE audit_log SET event = event'));
    await db.end();
  });

  test('projects: seeded filing on cards; create; add (first is primary), filter, remove promotes; archive; 404/409/422', async () => {
    const list = (await api('/projects')).body.items;
    assert.equal(list.length, 3);
    const board = list.find((p) => p.name === 'Q3 board meeting');
    const pune = list.find((p) => p.name === 'Pune client visit');
    const filed = (await api(`/emails?project=${board.id}&limit=50`)).body.items;
    assert.ok(filed.length > 0, 'seeded emails in the board project');
    assert.ok(filed.every((e) => e.projects.some((p) => p.id === board.id)));
    assert.deepEqual(Object.keys(filed[0].projects[0]).sort(), ['colour', 'id', 'is_primary', 'name']);
    assert.equal((await api('/emails?project=nope')).status, 422);

    const created = await api('/projects', { method: 'POST', body: JSON.stringify({ name: '  Audit prep ', colour: '#AABBCC', icon: '🧾' }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.name, 'Audit prep');
    assert.equal(created.body.colour, '#aabbcc');
    assert.deepEqual(created.body.progress, { done: 0, total: 0 });
    const bad = await api('/projects', { method: 'POST', body: JSON.stringify({ name: '', colour: 'red', jira_project_key: 'x' }) });
    assert.equal(bad.status, 422);
    for (const k of ['name', 'colour', 'jira_project_key']) assert.ok(k in bad.body.error.details.fields, k);

    const email = (await api('/emails?limit=50')).body.items.find((e) => e.projects.length === 0);
    const audit = created.body.id;
    const add = (pid, body) => api(`/projects/${pid}/items`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await add(audit, { email_id: email.id })).body.is_primary, true);
    assert.equal((await add(pune.id, { email_id: email.id })).body.is_primary, false);
    assert.equal((await add(audit, { email_id: email.id })).body.is_primary, true, 'adding twice changes nothing');
    let refs = (await api(`/emails/${email.id}`)).body.projects;
    assert.deepEqual(refs.map((r) => [r.id, r.is_primary]), [[audit, true], [pune.id, false]]);
    assert.equal((await api(`/projects/${audit}/items/${email.id}`, { method: 'DELETE' })).status, 204);
    refs = (await api(`/emails/${email.id}`)).body.projects;
    assert.deepEqual(refs.map((r) => [r.id, r.is_primary]), [[pune.id, true]]);
    assert.equal((await api(`/projects/${audit}/items/${email.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await add(audit, { email_id: email.id, action_id: email.id })).status, 422);

    // A card in a project shows on its board (GET /actions?project=).
    const card = (await api('/actions?status=done&limit=50')).body.items.find((a) => a.board_column);
    if (card) {
      await add(audit, { action_id: card.id });
      assert.ok((await api(`/actions?status=done&project=${audit}&limit=50`)).body.items.some((a) => a.id === card.id));
      assert.equal((await api(`/projects/${audit}`)).body.progress.total, 1);
    }

    const archived = await api(`/projects/${audit}`, { method: 'PATCH', body: JSON.stringify({ archived: true, name: 'Audit 2026' }) });
    assert.equal(archived.body.name, 'Audit 2026');
    assert.ok(archived.body.archived_at);
    assert.equal((await add(audit, { email_id: email.id })).status, 409);
    assert.equal((await api('/projects')).body.items.at(-1).id, audit, 'archived last');
    assert.equal((await api('/projects/00000000-0000-4000-8000-000000000000')).status, 404);
  });

  test('user cards: create 201 in To do, 422s, edit payload, file in a project, 409 on email actions, delete 204', async () => {
    const bad = await api('/actions', { method: 'POST', body: JSON.stringify({ type: 'add_board_card', payload: { title: '', urgency: 'Huge', due_time: '25:00' } }) });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.body.error.details.fields).sort(), ['payload.due_time', 'payload.title', 'payload.urgency']);
    const made = await api('/actions', { method: 'POST', body: JSON.stringify({ type: 'add_board_card', payload: { title: ' Call the bank ', source: 'call' } }) });
    assert.equal(made.status, 201);
    const card = made.body;
    assert.equal(card.board_column, 'todo');
    assert.equal(card.payload.title, 'Call the bank');
    assert.deepEqual(card.projects, []);
    const todo = (await api('/actions?status=done&column=todo&limit=50')).body.items;
    assert.equal(todo.at(-1).id, card.id);
    const edited = await api(`/actions/${card.id}`, { method: 'PATCH', body: JSON.stringify({ payload: { urgency: 'High', due_date: '2026-12-01', due_time: '09:30' } }) });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.payload.source, 'call');
    assert.equal(edited.body.payload.due_time, '09:30');
    const project = (await api('/projects', { method: 'POST', body: JSON.stringify({ name: 'Bank', colour: '#336699' }) })).body;
    await api(`/projects/${project.id}/items`, { method: 'POST', body: JSON.stringify({ action_id: card.id }) });
    const inProject = (await api(`/actions?project=${project.id}`)).body.items;
    assert.deepEqual(inProject.map((a) => a.id), [card.id]);
    assert.deepEqual(inProject[0].projects, [{ id: project.id, name: 'Bank', colour: '#336699', is_primary: true }]);
    const emailAction = (await api('/actions?limit=50')).body.items.find((a) => a.email_id);
    assert.equal((await api(`/actions/${emailAction.id}`, { method: 'PATCH', body: JSON.stringify({ payload: { title: 'x' } }) })).status, 409);
    assert.equal((await api(`/actions/${emailAction.id}`, { method: 'DELETE' })).status, 409);
    assert.equal((await api(`/actions/${card.id}`, { method: 'DELETE' })).status, 204);
    assert.ok(!(await api('/actions?status=done&column=todo&limit=50')).body.items.some((a) => a.id === card.id));
  });

  test('notes: stored as typed, scoped lists, note_count, 404 for others, 422s', async () => {
    const email = (await api('/emails?limit=1')).body.items[0];
    const made = await api('/notes', { method: 'POST', body: JSON.stringify({ target_type: 'email', target_id: email.id, body: 'VPN password: hunter2\n- [ ] book room' }) });
    assert.equal(made.status, 201);
    assert.equal(made.body.body, 'VPN password: hunter2\n- [ ] book room');
    assert.equal((await api(`/emails/${email.id}`)).body.note_count, 1);
    const loose = (await api('/notes', { method: 'POST', body: JSON.stringify({ body: 'standalone' }) })).body;
    assert.deepEqual((await api('/notes?target_type=none')).body.items.map((n) => n.id), [loose.id]);
    assert.deepEqual((await api(`/notes?target_type=email&target_id=${email.id}`)).body.items.map((n) => n.id), [made.body.id]);
    assert.equal((await api('/notes', { method: 'POST', body: JSON.stringify({ target_type: 'email', body: 'x' }) })).status, 422);
    assert.equal((await api('/notes', { method: 'POST', body: JSON.stringify({ target_type: 'project', target_id: '00000000-0000-4000-8000-000000000000', body: 'x' }) })).status, 404);
    const patched = await api(`/notes/${made.body.id}`, { method: 'PATCH', body: JSON.stringify({ body: 'OTP 123456' }) });
    assert.equal(patched.body.body, 'OTP 123456');
    assert.equal((await api(`/notes/${made.body.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/emails/${email.id}`)).body.note_count, 0);
    assert.equal((await api(`/notes/${made.body.id}`, { method: 'DELETE' })).status, 404);
  });

  test('files: upload to a card (name cleaned, hashed), safe headers, inline only for images/PDFs, 413/404/422, delete', async () => {
    const card = (await api('/actions', { method: 'POST', body: JSON.stringify({ type: 'add_board_card', payload: { title: 'Files' } }) })).body;
    const upload = (name, type, bytes, target = card.id) => {
      const form = new FormData();
      form.append('target_type', 'card');
      form.append('target_id', target);
      form.append('file', new File([bytes], name, { type }));
      return fetch(`${base}/api/v1/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };
    const res = await upload('../../etc/page.html', 'text/html', '<script>alert(1)</script>');
    assert.equal(res.status, 201);
    const ref = await res.json();
    assert.equal(ref.filename, 'page.html');
    assert.equal(ref.size, 25);
    assert.deepEqual((await api(`/files?target_type=card&target_id=${card.id}`)).body.items.map((f) => f.id), [ref.id]);
    for (const q of ['', '?inline=1']) {
      const got = await fetch(`${base}/api/v1/files/${ref.id}${q}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(got.status, 200);
      assert.match(got.headers.get('content-disposition'), /^attachment;/);
      assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
      assert.match(got.headers.get('content-security-policy'), /sandbox/);
      assert.equal(await got.text(), '<script>alert(1)</script>');
    }
    const png = await (await upload('a.png', 'image/png', 'png')).json();
    assert.match((await fetch(`${base}/api/v1/files/${png.id}?inline=1`, { headers: { Authorization: `Bearer ${token}` } })).headers.get('content-disposition'), /^inline;/);
    assert.equal((await upload('big.bin', 'application/octet-stream', new Uint8Array(25 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await upload('x.txt', 'text/plain', 'x', '00000000-0000-4000-8000-000000000000')).status, 404);
    const noFile = new FormData();
    noFile.append('target_type', 'card');
    noFile.append('target_id', card.id);
    assert.equal((await fetch(`${base}/api/v1/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: noFile })).status, 422);
    assert.equal((await api(`/files/${ref.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/files/${ref.id}`)).status, 404);
    // Deleting the card takes its files with it.
    assert.equal((await api(`/actions/${card.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/files/${png.id}`)).status, 404);
  });

  test('notifications: read some by id, then all; ids must be UUIDs', async () => {
    const { pool } = await import('../src/services/db.js');
    const { rows: [u] } = await pool.query("SELECT id FROM users WHERE email = 'demo@northwind.example'");
    const ids = [];
    for (const title of ['a', 'b', 'c']) {
      const { rows: [n] } = await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'reminder', $2) RETURNING id", [u.id, { title }]);
      ids.push(String(n.id));
    }
    const unread = async () => (await api('/notifications')).body.items.filter((n) => ids.includes(n.id) && n.read_at === null).map((n) => n.id);
    assert.deepEqual((await unread()).sort(), [...ids].sort());
    assert.equal((await api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [ids[0]] }) })).status, 204);
    assert.deepEqual((await unread()).sort(), [ids[1], ids[2]].sort());
    assert.equal((await api('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: ['x'] }) })).status, 422);
    assert.equal((await api('/notifications/read', { method: 'POST', body: JSON.stringify({}) })).status, 204);
    assert.deepEqual(await unread(), []);
  });

  test('preferences: pop-up rules, quiet hours and key binds are stored; bad shapes are 422 (proposals §28)', async () => {
    const patch = (body) => api('/me/preferences', { method: 'PATCH', body: JSON.stringify(body) });
    const rules = { normal: { urgency: 'high', sentiment: 'frustrated' }, focus: { urgency: 'critical', sentiment: 'off' }, quiet: { urgency: 'none', sentiment: 'off' } };
    const ok = await patch({ popup_rules: rules, quiet_hours: { start: '22:00', end: '08:00' }, keybinds: { lock: 'Alt+Q' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.ui_prefs.popup_rules, rules);
    assert.deepEqual(ok.body.ui_prefs.keybinds, { lock: 'Alt+Q' });
    assert.equal((await patch({ quiet_hours: null })).body.ui_prefs.quiet_hours, null);
    for (const body of [{ popup_rules: { normal: rules.normal } }, { quiet_hours: { start: '9am', end: '08:00' } }, { keybinds: { teleport: 'T' } }]) {
      assert.equal((await patch(body)).status, 422);
    }
    await patch({ keybinds: {} });
    const onb = await patch({ onboarding: { tour: 'paused', tour_step: 2, done: ['search'] } });
    assert.equal(onb.status, 200);
    assert.deepEqual(onb.body.ui_prefs.onboarding, { tour: 'paused', tour_step: 2, done: ['search'] });
    assert.equal((await patch({ onboarding: { tour: 'later' } })).status, 422);
  });

  test('files: an email is a target too; someone else\'s email is a 404', async () => {
    const email = (await api('/emails?limit=1')).body.items[0];
    const send = (target) => {
      const form = new FormData();
      form.append('target_type', 'email');
      form.append('target_id', target);
      form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
      return fetch(`${base}/api/v1/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };
    const made = await send(email.id);
    assert.equal(made.status, 201);
    const ref = await made.json();
    assert.deepEqual((await api(`/files?target_type=email&target_id=${email.id}`)).body.items.map((f) => f.id), [ref.id]);
    assert.equal((await send('00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await api(`/files/${ref.id}`, { method: 'DELETE' })).status, 204);
  });

  test('reminders: create on an email, list, reschedule, cancel; fires once as a notification; 404/422', async () => {
    const { fireDueReminders } = await import('../src/api/reminders.js');
    const email = (await api('/emails?limit=1')).body.items[0];
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const made = await api('/reminders', { method: 'POST', body: JSON.stringify({ target: { type: 'email', id: email.id }, title: 'Call back', fire_at: soon }) });
    assert.equal(made.status, 201);
    assert.deepEqual([made.body.kind, made.body.status, made.body.target], ['manual', 'scheduled', { type: 'email', id: email.id }]);
    assert.equal((await api('/reminders?status=scheduled')).body.items.some((r) => r.id === made.body.id), true);
    const later = new Date(Date.now() + 7_200_000).toISOString();
    assert.equal((await api(`/reminders/${made.body.id}`, { method: 'PATCH', body: JSON.stringify({ fire_at: later }) })).body.fire_at, later);
    for (const bad of [{ title: '', fire_at: soon }, { title: 'x', fire_at: '2001-01-01T00:00:00Z' }, { title: 'x', fire_at: soon, target: { type: 'email', id: '1' } }]) {
      assert.ok([404, 422].includes((await api('/reminders', { method: 'POST', body: JSON.stringify(bad) })).status));
    }
    assert.equal((await api('/reminders', { method: 'POST', body: JSON.stringify({ target: { type: 'email', id: '00000000-0000-4000-8000-000000000000' }, title: 'x', fire_at: soon }) })).status, 404);
    // Due now: the tick fires it exactly once.
    const { pool } = await import('../src/services/db.js');
    await pool.query("UPDATE reminders SET fire_at = now() - interval '1 second' WHERE id = $1", [made.body.id]);
    assert.ok((await fireDueReminders()) >= 1);
    assert.equal(await fireDueReminders(), 0);
    const n = (await api('/notifications')).body.items.find((x) => x.body === 'Call back');
    assert.deepEqual([n.kind, n.title, n.target], ['reminder', 'Reminder due', { type: 'email', id: email.id }]);
    assert.equal((await api(`/reminders/${made.body.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/reminders/${made.body.id}`, { method: 'DELETE' })).status, 404);
  });

  test('layouts: starter by default; full replace; stale save 409; bad stack 422', async () => {
    const start = (await api('/layouts/desktop')).body;
    assert.equal(start.is_default, true);
    const pages = [{ ...start.pages[0], name: 'Mine' }];
    const saved = await api('/layouts/desktop', { method: 'PUT', body: JSON.stringify({ pages, base_updated_at: null }) });
    assert.equal(saved.status, 200);
    assert.equal((await api('/layouts/desktop', { method: 'PUT', body: JSON.stringify({ pages, base_updated_at: null }) })).status, 409);
    const next = await api('/layouts/desktop', { method: 'PUT', body: JSON.stringify({ pages, base_updated_at: saved.body.updated_at }) });
    assert.equal(next.status, 200);
    const bad = structuredClone(pages);
    bad[0].widgets[0].stacked = true;
    const r = await api('/layouts/desktop', { method: 'PUT', body: JSON.stringify({ pages: bad, base_updated_at: next.body.updated_at }) });
    assert.equal(r.status, 422);
    assert.ok('pages.0.widgets.0.stacked' in r.body.error.details.fields);
  });

  test('sign out clears the cookie', async () => {
    const r = await api('/auth/logout', { method: 'POST' });
    assert.equal(r.status, 204);
    assert.match(r.res.headers.get('set-cookie'), /secep_refresh=;/);
  });
});
