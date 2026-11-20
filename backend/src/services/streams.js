// M6 stream consumers (§6.5): emails.triaged / emails.enriched (Redis Streams, consumer group "api")
// -> the Socket.io events the dashboard already handles (frontend/src/api/realtime.ts).
// The API must boot and serve without Redis: connection errors are logged once per outage and retried.
import Redis from 'ioredis';
import { query } from './db.js';
import { publish } from './events.js';
import { listItem, toAction } from './emails.js';

const GROUP = 'api';
const CONSUMER = `api-${process.pid}`;
const STREAMS = ['emails.triaged', 'emails.enriched'];

let client = null;
let stopped = false;

/** The mailbox owner, from the DB (stream payloads are not trusted for routing). */
async function ownerOf(emailId) {
  const { rows } = await query('SELECT m.user_id FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id WHERE e.id = $1', [emailId]);
  return rows[0]?.user_id ?? null;
}

async function onTriaged(msg) {
  const userId = await ownerOf(msg.email_id);
  if (!userId) return;
  const email = await listItem(userId, msg.email_id);
  if (email) publish(userId, 'email.triaged', { email_id: msg.email_id, email });
}

async function onEnriched(msg) {
  const userId = await ownerOf(msg.email_id);
  if (!userId) return;
  const [e, s, a] = await Promise.all([
    query('SELECT status FROM emails WHERE id = $1', [msg.email_id]),
    query('SELECT one_line, short FROM summaries WHERE email_id = $1', [msg.email_id]),
    query('SELECT * FROM actions WHERE email_id = $1 AND user_id = $2 ORDER BY created_at', [msg.email_id, userId]),
  ]);
  publish(userId, 'email.enriched', {
    email_id: msg.email_id,
    status: e.rows[0]?.status ?? 'enriched',
    summary_one_line: s.rows[0]?.one_line ?? null,
    summary_short: s.rows[0]?.short ?? null,
    actions: a.rows.map(toAction),
  });
}

const HANDLERS = { 'emails.triaged': onTriaged, 'emails.enriched': onEnriched };

async function ensureGroups(r) {
  for (const s of STREAMS) {
    try {
      await r.xgroup('CREATE', s, GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!String(err.message).includes('BUSYGROUP')) throw err;
    }
  }
}

async function handleBatch(r, res) {
  for (const [stream, entries] of res ?? []) {
    for (const [id, fields] of entries) {
      try {
        const i = fields.indexOf('data');
        const msg = i >= 0 ? JSON.parse(fields[i + 1]) : null;
        if (msg?.email_id) await HANDLERS[stream](msg);
      } catch (err) {
        console.error(`stream ${stream} ${id} failed:`, err.code ?? err.name);
      }
      await r.xack(stream, GROUP, id);
    }
  }
}

async function loop(r) {
  let ready = false;
  while (!stopped) {
    try {
      if (!ready) {
        await ensureGroups(r);
        // Anything left unacknowledged by a previous run first.
        await handleBatch(r, await r.xreadgroup('GROUP', GROUP, CONSUMER, 'COUNT', 100, 'STREAMS', ...STREAMS, ...STREAMS.map(() => '0')));
        ready = true;
      }
      const res = await r.xreadgroup('GROUP', GROUP, CONSUMER, 'COUNT', 50, 'BLOCK', 5000, 'STREAMS', ...STREAMS, ...STREAMS.map(() => '>'));
      await handleBatch(r, res);
    } catch {
      if (stopped) return;
      ready = false;
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }
}

export function startStreams(url = process.env.REDIS_URL || 'redis://localhost:6379/0') {
  let down = false;
  client = new Redis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (n) => Math.min(n * 500, 10_000),
  });
  client.on('error', (err) => {
    if (!down) console.error('redis unavailable, live pipeline updates paused:', err.code ?? err.name);
    down = true;
  });
  client.on('ready', () => {
    if (down) console.log('redis reconnected');
    down = false;
  });
  loop(client).catch(() => {});
}

export async function stopStreams() {
  stopped = true;
  client?.disconnect();
}
