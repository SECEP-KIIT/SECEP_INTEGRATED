// HTTP plumbing for /api/v1 (SRS §6.4.1 errors, §4.3 deny by default). Every route is registered through
// `route()` with an access rule; there is no way to add one without it.
import { randomUUID } from 'node:crypto';
import { verifyAccess } from './services/tokens.js';
import { query } from './services/db.js';

export class Fail extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Every registered route, so a test can check the §6.5 table. */
export const registry = [];

async function userFor(req) {
  const header = req.get('Authorization');
  const claims = header?.startsWith('Bearer ') ? verifyAccess(header.slice(7)) : null;
  if (!claims) return null;
  const { rows } = await query(
    `SELECT u.*, m.address AS mb_address, m.status AS mb_status, m.last_polled_at AS mb_last_polled_at, m.id AS mailbox_id
       FROM users u LEFT JOIN mailboxes m ON m.user_id = u.id WHERE u.id = $1`,
    [claims.sub],
  );
  return rows[0] ? { ...rows[0], auth_time: claims.auth_time } : null;
}

/**
 * Registers `method path` on `router`. access: public | user | admin | security.review. Handlers get
 * (req, user) and return a value (200 JSON), undefined (204) or call res themselves (`raw: true`).
 */
export function route(router, method, path, access, handler, { status = 200, raw = false } = {}) {
  registry.push({ method, path, access });
  router[method](path, async (req, res, next) => {
    try {
      let user = null;
      if (access !== 'public') {
        user = await userFor(req);
        if (!user) throw new Fail(401, 'unauthenticated', 'Missing or expired access token');
        if (access === 'admin' && !user.is_admin) throw new Fail(403, 'forbidden', 'Admins only');
        if (access === 'security.review' && !user.permissions.includes('security.review')) {
          throw new Fail(403, 'forbidden', 'Requires the security.review permission');
        }
      }
      const result = await handler(req, user, res);
      if (raw || res.headersSent) return;
      if (result === undefined) res.status(204).end();
      else res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  });
}

export function errorBody(code, message, details = null) {
  return { error: { code, message, details, request_id: `req_${randomUUID().slice(0, 12)}` } };
}

/** §6.4.1 error envelope. Never echoes internals: unexpected errors become 500 with a request id to look up. */
// Express recognises error handlers by their 4-argument signature, so `_next` must stay.
export function errorHandler(err, req, res, _next) {
  if (err instanceof Fail) return res.status(err.status).json(errorBody(err.code, err.message, err.details));
  if (err?.type === 'entity.parse.failed') return res.status(400).json(errorBody('bad_request', 'Malformed JSON body'));
  const body = errorBody('internal', 'Something went wrong');
  // Logs carry the request id and the error, never request bodies (NFR-SEC-007).
  console.error(body.error.request_id, err);
  res.status(500).json(body);
}

/** Owner check: 404, so other users' ids are never confirmed to exist. */
export function own(row, what) {
  if (!row) throw new Fail(404, 'not_found', `${what} not found`);
  return row;
}

// ── Validation (stands in for zod: strict objects, field errors → 422 details.fields) ───────────────────────────
export class Fields {
  constructor(body) {
    this.body = body;
    this.errors = {};
  }
  add(field, message) {
    this.errors[field] ??= message;
  }
  only(allowed) {
    for (const k of Object.keys(this.body)) if (!allowed.includes(k)) this.add(k, 'Unknown field');
    return this;
  }
  done(code = 'validation_failed', message = 'Invalid request') {
    if (Object.keys(this.errors).length) throw new Fail(422, code, message, { fields: this.errors });
  }
}

export function object(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Fail(422, 'validation_failed', 'Expected a JSON object', { fields: { _: 'Expected an object' } });
  }
  return new Fields(body);
}

export const isStr = (v, max) => typeof v === 'string' && v.length <= max;
export const isOptStr = (v, max) => v === null || isStr(v, max);
export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isDateTime = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
export const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comma-separated query values from `allowed` (OR within a parameter); unknown values are 400. */
export function csv(params, name, allowed) {
  const raw = params.get(name);
  if (raw === null || raw === '') return null;
  const values = raw.split(',').map((v) => v.trim());
  const bad = values.find((v) => !allowed.includes(v));
  if (bad !== undefined) throw new Fail(400, 'bad_request', `Unknown ${name} value: ${bad}`);
  return values;
}

/** A uuid path parameter; anything else can't exist, so 404 (never a 500 from Postgres). */
export function idParam(req, what = 'Item') {
  if (!UUID.test(req.params.id)) throw new Fail(404, 'not_found', `${what} not found`);
  return req.params.id;
}

// ── Cursor pages (§6.4.1 { items, next_cursor }; limit 1–50, default 25) ───────────────────────────────────────
export function pageParams(params) {
  const raw = params.get('limit');
  const limit = raw === null ? 25 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Fail(400, 'bad_request', 'limit must be 1–50');
  const cursor = params.get('cursor');
  let offset = 0;
  if (cursor) {
    try {
      offset = JSON.parse(Buffer.from(cursor, 'base64').toString()).o;
    } catch {
      offset = -1;
    }
    if (!Number.isInteger(offset) || offset < 0) throw new Fail(400, 'bad_request', 'Invalid cursor');
  }
  return { limit, offset };
}

/** Rows fetched with LIMIT limit+1 → a page with the next cursor when there is more. */
export function toPage(rows, { limit, offset }) {
  const more = rows.length > limit;
  return {
    items: rows.slice(0, limit),
    next_cursor: more ? Buffer.from(JSON.stringify({ o: offset + limit })).toString('base64') : null,
  };
}

export const searchParams = (req) => new URL(req.originalUrl, 'http://x').searchParams;
