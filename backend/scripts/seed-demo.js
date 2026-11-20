// Seeds the demo tenant (Northwind) with the fake mailbox the frontend mock used (seed/demo-mailbox.json), shifted
// so it reads as recent mail. Dev and demo only: Gmail ingestion (M2) and the ML services fill a real tenant.
// Usage: npm run seed            (once; refuses if the demo tenant exists)
//        npm run seed -- --fresh (drops everything in the database first, then migrates and seeds)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encrypt } from '../src/services/crypto.js';
import { pool, tx } from '../src/services/db.js';

const seed = JSON.parse(readFileSync(new URL('../seed/demo-mailbox.json', import.meta.url), 'utf8'));
const TENANT = 'Northwind (demo)';
const DAY = 86_400_000;

if (process.argv.includes('--fresh')) {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  execFileSync(process.execPath, [fileURLToPath(new URL('./migrate.js', import.meta.url))], { stdio: 'inherit', env: process.env });
}
if ((await pool.query('SELECT 1 FROM tenants WHERE name = $1', [TENANT])).rows[0]) {
  console.log('The demo tenant already exists. Use --fresh to start over.');
  process.exit(0);
}

// Every timestamp moves by the time since the export; plain dates by whole days.
const delta = Date.now() - Date.parse(seed.epoch);
const days = Math.round(delta / DAY);
const shift = (v) => {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) return new Date(Date.parse(v) + delta).toISOString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(Date.parse(v) + days * DAY).toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]));
  return v;
};
const d = shift(seed);
const SIGNALS = ['safe_browsing', 'new_domain', 'mismatch', 'lookalike', 'shortener', 'ip_host', 'auth_fail'];

await tx(async (c) => {
  const { rows: [t] } = await c.query(
    `INSERT INTO tenants (name, domains, settings) VALUES ($1, '{northwind.example}', $2) RETURNING id`,
    // No Jira token: Jira is simulated (SIMULATE_INTEGRATIONS) until an admin adds real settings.
    [TENANT, { jira: { project_key: 'ATL' }, confidence_threshold: 0.6, protected_domains: ['northwind.example'], poll_interval_s: 30 }],
  );
  const mailbox = new Map();
  for (const u of d.users) {
    await c.query(
      `INSERT INTO users (id, tenant_id, email, display_name, role_category, is_admin, permissions, timezone, ui_prefs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Asia/Kolkata',$8)`,
      [u.id, t.id, u.email, u.display_name, u.role_category, u.is_admin, u.permissions, u.ui_prefs],
    );
    const { rows: [m] } = await c.query(
      `INSERT INTO mailboxes (tenant_id, user_id, address, refresh_token_enc, last_polled_at) VALUES ($1,$2,$3,$4, now()) RETURNING id`,
      [t.id, u.id, u.mailbox_address, encrypt('demo-mailbox-no-google-token')],
    );
    mailbox.set(u.id, m.id);
  }
  // Directory entries for internal senders (no mailbox, can't sign in without Google).
  for (const s of d.senders) {
    await c.query(`INSERT INTO users (tenant_id, email, display_name, role_category, timezone) VALUES ($1,$2,$3,$4,'Asia/Kolkata') ON CONFLICT (email) DO NOTHING`, [t.id, s.address, s.name, s.role]);
  }
  const owner = new Map(d.users.map((u) => [u.id, u.email]));
  for (const th of d.threads) {
    const last = th.messages.at(-1);
    await c.query(
      `INSERT INTO threads (id, tenant_id, mailbox_id, provider_thread_id, subject_norm, last_message_at, last_message_from_self, message_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [th.id, t.id, mailbox.get(th.user_id), th.id, last?.subject?.replace(/^(re|fwd?):\s*/i, '').toLowerCase() ?? null, last?.received_at ?? null,
        last?.from.address.toLowerCase() === owner.get(th.user_id), th.messages.length],
    );
  }
  for (const e of d.emails) {
    await c.query(
      `INSERT INTO emails (id, tenant_id, mailbox_id, thread_id, provider_message_id, message_id_hdr, from_addr, from_name, to_addrs, cc_addrs,
         recipient_position, subject, subject_norm, received_at, body_text, ml_text, attachments, auth_results, raw_size, status, security_flag, duplicate_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$19,$20,$21)`,
      [e.id, t.id, mailbox.get(e.user_id), e.thread_id, e.id, `<${e.id}@demo.secep>`, e.from.address, e.from.name, e.to.map((p) => p.address),
        e.cc.map((p) => p.address), e.recipient_position, e.subject, e.subject?.replace(/^(re|fwd?):\s*/i, '').toLowerCase() ?? null, e.received_at,
        e.body_text, JSON.stringify(e.attachments.map(({ filename, mime, size }) => ({ filename, mime, size, sha256: '' }))), e.auth_results,
        e.body_text.length, e.status, e.security_flag, e.duplicate_count],
    );
    if (e.triage) {
      const x = e.triage;
      await c.query(
        `INSERT INTO triage_results (email_id, email_type, type_conf, type_source, urgency, urgency_conf, sentiment, sentiment_score, sentiment_conf, needs_review, model_version, processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [e.id, x.email_type.label, x.email_type.confidence, x.email_type.source, x.urgency.label, x.urgency.confidence, x.sentiment.label,
          x.sentiment.score, x.sentiment.confidence, x.needs_review, x.model_version, x.processed_at],
      );
    }
    if (e.summary) await c.query(`INSERT INTO summaries (email_id, one_line, short, model) VALUES ($1,$2,$3,'demo')`, [e.id, e.summary.one_line, e.summary.short]);
  }
  for (const a of d.actions) {
    await c.query(
      `INSERT INTO actions (id, tenant_id, email_id, user_id, type, payload, origin, status, board_column, board_position, external_kind, external_ref, external_status, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [a.id, t.id, a.email_id, a.user_id, a.type, a.payload, a.origin, a.status, a.board_column, a.board_position,
        a.external_ref ? (a.type === 'create_jira_issue' ? 'jira_issue' : 'calendar_event') : null, a.external_ref, a.external_status, a.error, a.created_at, a.updated_at],
    );
  }
  for (const u of d.url_checks.filter((x) => x.verdict !== 'pending')) {
    await c.query(
      `INSERT INTO url_checks (id, email_id, url, anchor_text, host, signals, verdict, final_url, redirect_chain) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, u.email_id, u.url, u.anchor_text, u.host, Object.fromEntries(SIGNALS.map((s) => [s, u.signals.includes(s)])),
        u.click_verdict ?? u.verdict, u.final_url, JSON.stringify(u.chain)],
    );
  }
  let n = 0;
  for (const s of d.secrets) {
    // created_at keeps the token order in the body (detail lists secrets in that order).
    await c.query(
      `INSERT INTO masked_secrets (id, email_id, owner_user_id, secret_type, value_enc, created_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))`,
      // The value is never kept for SECEP (proposals §18.4): the pipeline drops it. value_enc is NOT NULL in 001_init,
      // so a fixed placeholder fills it until M7 makes the column optional.
      [s.id, s.email_id, s.owner_user_id, s.secret_type, encrypt('[omitted]'), n++ / 1000],
    );
  }
  for (const [userId, ids] of Object.entries(d.reads)) {
    for (const id of ids) await c.query(`INSERT INTO email_user_state (user_id, email_id, read_at) VALUES ($1,$2, now()) ON CONFLICT (user_id, email_id) DO UPDATE SET read_at = now()`, [userId, id]);
  }
  for (const [userId, pairs] of Object.entries(d.handled)) {
    for (const [id, at] of pairs) await c.query(`INSERT INTO email_user_state (user_id, email_id, handled_at) VALUES ($1,$2,$3) ON CONFLICT (user_id, email_id) DO UPDATE SET handled_at = $3`, [userId, id, at]);
  }
  for (const p of d.projects) {
    await c.query(
      `INSERT INTO projects (id, tenant_id, owner_user_id, name, colour, icon, description, deadline, jira_project_key, jira_epic, archived_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [p.id, t.id, p.user_id, p.name, p.colour, p.icon, p.description, p.deadline, p.jira_project_key, p.jira_epic, p.archived_at, p.created_at],
    );
  }
  // Some of the demo mailbox already filed (FR-UI-016), as in the mock: the board deck and the Pune trip by subject.
  const file = async (project, match) => {
    if (!project) return;
    for (const e of d.emails.filter((x) => x.user_id === project.user_id && match.test(x.subject ?? ''))) {
      const has = (await c.query('SELECT 1 FROM email_projects WHERE email_id = $1', [e.id])).rows[0];
      await c.query('INSERT INTO email_projects (email_id, project_id, is_primary, added_at) VALUES ($1,$2,$3,$4)', [e.id, project.id, !has, e.received_at]);
    }
  };
  await file(d.projects[0], /Q3 board|board deck/i);
  await file(d.projects[1], /Pune/i);
});
console.log(`Seeded ${TENANT}: ${seed.emails.length} emails for ${seed.users.length} users. Sign in as demo@northwind.example (DEV_LOGIN=1).`);
await pool.end();
