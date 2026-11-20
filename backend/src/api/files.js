// Files (FR-CNT-006/007/008, proposals §19.3). Uploads stream through busboy to the files volume, hashed on the way,
// within 25 MB a file and the user's quota (tenants.settings.file_quota_mb, default 500). Downloads are always
// attachments with nosniff and a sandbox CSP; ?inline=1 only for images and PDFs. File contents are never logged.
import Busboy from 'busboy';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { Fail, UUID, idParam, own, pageParams, route, searchParams, toPage } from '../http.js';
import { query } from '../services/db.js';

export const files = Router();

const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_QUOTA_MB = 500;
const TARGETS = ['email', 'card', 'project'];
const PREVIEW = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

const toRef = (f) => ({
  id: f.id, target_type: f.target_type, target_id: f.target_id, filename: f.filename, mime: f.mime,
  size: Number(f.size_bytes), created_at: f.created_at.toISOString(),
});

/** Only the last path part, no control characters or quotes, at most 200 characters. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const safeName = (name) => (String(name).split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200) || 'file';

const root = () => resolve(config.filesDir);
/** Deletes stored bytes; a missing file is fine. */
export const removeStored = (keys) => Promise.all(keys.map((k) => rm(join(root(), k), { force: true })));

async function checkTarget(user, type, id) {
  if (!UUID.test(id ?? '')) throw new Fail(404, 'not_found', 'Target not found');
  const sql = {
    email: 'SELECT e.id FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id WHERE e.id = $1 AND m.user_id = $2',
    card: 'SELECT id FROM actions WHERE id = $1 AND user_id = $2 AND email_id IS NULL',
    project: 'SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2',
  }[type];
  own((await query(sql, [id, user.id])).rows[0], type === 'card' ? 'Card' : type === 'email' ? 'Email' : 'Project');
}

/** FR-CNT-008 headers on every download. */
function sendHeaders(res, filename, mime, inline) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.set({
    'Content-Type': mime,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'private, no-store',
  });
}

/** Streams one multipart file to a temporary path; resolves with the fields and what was written. */
function receive(req, tmp) {
  return new Promise((resolveP, reject) => {
    let bb;
    try {
      bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BYTES, fields: 4, fieldSize: 200 } });
    } catch {
      reject(new Fail(400, 'bad_request', 'Expected multipart/form-data'));
      return;
    }
    const fields = {};
    let file = null;
    let writing = Promise.resolve();
    bb.on('field', (name, value) => (fields[name] = value));
    bb.on('file', (_name, stream, info) => {
      const hash = createHash('sha256');
      const out = createWriteStream(tmp);
      file = { filename: safeName(info.filename), mime: info.mimeType || 'application/octet-stream', size: 0, truncated: false, sha256: null };
      stream.on('data', (chunk) => {
        file.size += chunk.length;
        hash.update(chunk);
      });
      stream.on('limit', () => (file.truncated = true));
      writing = new Promise((ok, fail) => {
        out.on('finish', ok);
        out.on('error', fail);
      }).then(() => (file.sha256 = hash.digest('hex')));
      stream.pipe(out);
    });
    bb.on('error', reject);
    bb.on('close', () => writing.then(() => resolveP({ fields, file }), reject));
    req.pipe(bb);
  });
}

route(files, 'get', '/files', 'user', async (req, user) => {
  const params = searchParams(req);
  const p = pageParams(params);
  const type = params.get('target_type');
  const id = params.get('target_id');
  if (!TARGETS.includes(type) || !id) throw new Fail(400, 'bad_request', 'target_type (email, card or project) and target_id are required');
  await checkTarget(user, type, id);
  const { rows } = await query(
    'SELECT * FROM files WHERE owner_user_id = $1 AND target_type = $2 AND target_id = $3 ORDER BY created_at DESC LIMIT $4 OFFSET $5',
    [user.id, type, id, p.limit + 1, p.offset],
  );
  return toPage(rows.map(toRef), p);
});

route(files, 'post', '/files', 'user', async (req, user) => {
  if (Number(req.headers['content-length']) > MAX_BYTES + 64 * 1024) throw new Fail(413, 'file_too_large', 'Files can be at most 25 MB');
  const dir = join(root(), user.tenant_id);
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const tmp = join(dir, `.upload-${id}`);
  try {
    const { fields, file } = await receive(req, tmp);
    const bad = {};
    if (!TARGETS.includes(fields.target_type)) bad.target_type = 'Must be email, card or project';
    if (!fields.target_id) bad.target_id = 'Required';
    if (!file) bad.file = 'Required';
    if (Object.keys(bad).length) throw new Fail(422, 'validation_failed', 'Some fields are invalid', { fields: bad });
    if (file.truncated) throw new Fail(413, 'file_too_large', 'Files can be at most 25 MB');
    await checkTarget(user, fields.target_type, fields.target_id);
    const { rows: [q] } = await query(
      `SELECT coalesce((SELECT sum(size_bytes) FROM files WHERE owner_user_id = $1), 0)::bigint AS used,
              coalesce((settings->>'file_quota_mb')::int, $3) AS quota_mb FROM tenants WHERE id = $2`,
      [user.id, user.tenant_id, DEFAULT_QUOTA_MB],
    );
    if (Number(q.used) + file.size > q.quota_mb * 1024 * 1024) throw new Fail(413, 'quota_exceeded', 'Your file space is full. Delete some files first.');
    const key = `${user.tenant_id}/${id}`;
    await rename(tmp, join(root(), key));
    const { rows: [row] } = await query(
      `INSERT INTO files (id, tenant_id, owner_user_id, target_type, target_id, filename, mime, size_bytes, sha256, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, user.tenant_id, user.id, fields.target_type, fields.target_id, file.filename, file.mime, file.size, file.sha256, key],
    );
    return toRef(row);
  } finally {
    await rm(tmp, { force: true });
  }
}, { status: 201 });

route(files, 'get', '/files/:id', 'user', async (req, user, res) => {
  const id = idParam(req, 'File');
  const f = own((await query('SELECT * FROM files WHERE id = $1 AND owner_user_id = $2', [id, user.id])).rows[0], 'File');
  const stream = createReadStream(join(root(), f.storage_key));
  await new Promise((ok, fail) => {
    stream.once('open', ok);
    stream.once('error', () => fail(new Fail(404, 'not_found', 'File not found')));
  });
  sendHeaders(res, f.filename, f.mime, searchParams(req).get('inline') === '1' && PREVIEW.test(f.mime));
  res.set('Content-Length', String(f.size_bytes));
  stream.pipe(res);
}, { raw: true });

route(files, 'delete', '/files/:id', 'user', async (req, user) => {
  const id = idParam(req, 'File');
  const { rows: [f] } = await query('DELETE FROM files WHERE id = $1 AND owner_user_id = $2 RETURNING storage_key', [id, user.id]);
  own(f, 'File');
  await removeStored([f.storage_key]);
});

// FR-CNT-007: an email attachment, streamed from Gmail and never stored. Needs the Gmail attachment id, which M1
// does not store yet (proposals §19.3), and the mailbox's Google token; until then the API says it's unavailable.
route(files, 'get', '/emails/:id/attachments/:index', 'user', async (req, user) => {
  const id = idParam(req, 'Email');
  const { rows: [e] } = await query(
    'SELECT e.attachments FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id WHERE e.id = $1 AND m.user_id = $2',
    [id, user.id],
  );
  own(e, 'Email');
  const index = /^\d+$/.test(req.params.index) ? Number(req.params.index) : -1;
  if (!e.attachments[index]) throw new Fail(404, 'not_found', 'Attachment not found');
  throw new Fail(503, 'unavailable', "Attachments can't be fetched from Gmail yet");
});
