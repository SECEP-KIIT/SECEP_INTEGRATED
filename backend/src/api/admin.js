// Administration (FR-ADM-002/003, SRS §6.5). Settings first: GET and PUT /admin/settings and POST /admin/settings/test.
// Wire shapes follow the mock (frontend src/mocks/routes/admin.ts, serialize.ts): secrets are write-only, GET only says
// whether they are set. Stored in tenants.settings (jsonb) as { jira: { site_url, email, token_enc, project_key },
// llm: { base_url, model, api_style, api_key_enc }, confidence_threshold, protected_domains, poll_interval_s }.
import { Router } from 'express';
import { Fail, isEmail, isInt, isOptStr, object, route } from '../http.js';
import { audit } from '../services/audit.js';
import { decrypt, encrypt } from '../services/crypto.js';
import { query, tx } from '../services/db.js';
import { testJira } from '../services/jira.js';

export const admin = Router();

const url = (v) => v === null || (typeof v === 'string' && /^https?:\/\/\S+$/.test(v) && v.length <= 500);
const JIRA_KEYS = {
  site_url: url,
  email: (v) => v === null || isEmail(v),
  project_key: (v) => v === null || (typeof v === 'string' && /^[A-Z][A-Z0-9]{1,9}$/.test(v)),
  token: (v) => typeof v === 'string' && v.length > 0 && v.length <= 500,
  token_set: () => true, // the client may send back what GET gave it; ignored
};
const LLM_KEYS = {
  base_url: url,
  model: (v) => isOptStr(v, 200),
  api_style: (v) => v === 'ollama' || v === 'openai',
  api_key: (v) => typeof v === 'string' && v.length <= 500,
  api_key_set: () => true,
};

function checkSection(f, name, value, keys) {
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return f.add(name, 'Must be an object');
  for (const [k, v] of Object.entries(value)) {
    if (!keys[k]) f.add(`${name}.${k}`, 'Unknown field');
    else if (!keys[k](v)) f.add(`${name}.${k}`, 'Invalid value');
  }
}

/** The §6.4.1 Settings shape. Secret values never leave here, only whether they are set. */
function toSettings(s = {}) {
  const j = s.jira ?? {};
  const l = s.llm ?? {};
  return {
    jira: { site_url: j.site_url ?? null, email: j.email ?? null, project_key: j.project_key ?? null, token_set: !!j.token_enc },
    llm: { base_url: l.base_url ?? null, model: l.model ?? null, api_style: l.api_style ?? 'ollama', api_key_set: !!l.api_key_enc },
    confidence_threshold: s.confidence_threshold ?? 0.6,
    protected_domains: s.protected_domains ?? [],
    poll_interval_s: s.poll_interval_s ?? 30,
  };
}

async function settingsOf(user) {
  const { rows } = await query('SELECT settings FROM tenants WHERE id = $1', [user.tenant_id]);
  return rows[0]?.settings ?? {};
}

route(admin, 'get', '/admin/settings', 'admin', async (_req, user) => toSettings(await settingsOf(user)));

route(admin, 'put', '/admin/settings', 'admin', async (req, user) => {
  const f = object(req.body).only(['jira', 'llm', 'confidence_threshold', 'protected_domains', 'poll_interval_s']);
  checkSection(f, 'jira', f.body.jira, JIRA_KEYS);
  checkSection(f, 'llm', f.body.llm, LLM_KEYS);
  const b = f.body;
  if ('confidence_threshold' in b && !(typeof b.confidence_threshold === 'number' && b.confidence_threshold >= 0 && b.confidence_threshold <= 1)) {
    f.add('confidence_threshold', 'Must be between 0 and 1');
  }
  if ('protected_domains' in b && !(Array.isArray(b.protected_domains) && b.protected_domains.length <= 100 && b.protected_domains.every((d) => typeof d === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))) {
    f.add('protected_domains', 'Must be a list of domains');
  }
  if ('poll_interval_s' in b && !isInt(b.poll_interval_s, 10, 3600)) f.add('poll_interval_s', 'Must be 10–3600 seconds');
  f.done();

  const saved = await tx(async (c) => {
    const { rows } = await c.query('SELECT settings FROM tenants WHERE id = $1 FOR UPDATE', [user.tenant_id]);
    if (!rows[0]) throw new Fail(404, 'not_found', 'Tenant not found');
    const next = { ...rows[0].settings, jira: { ...rows[0].settings.jira }, llm: { ...rows[0].settings.llm } };
    const { token, token_set: _t, ...jira } = b.jira ?? {};
    const { api_key: apiKey, api_key_set: _k, ...llm } = b.llm ?? {};
    Object.assign(next.jira, jira);
    Object.assign(next.llm, llm);
    // Secrets are write-only: encrypted when given (NFR-SEC-001), never echoed back.
    if (token !== undefined) next.jira.token_enc = encrypt(token);
    if (apiKey !== undefined) next.llm.api_key_enc = encrypt(apiKey);
    for (const k of ['confidence_threshold', 'protected_domains', 'poll_interval_s']) if (k in b) next[k] = b[k];
    await c.query('UPDATE tenants SET settings = $2 WHERE id = $1', [user.tenant_id, JSON.stringify(next)]);
    // Which settings changed, never their values (FR-ADM-006).
    await audit(c, { tenantId: user.tenant_id, actorId: user.id, event: 'settings.update', target: 'tenant', details: { changed: Object.keys(b) } });
    return next;
  });
  return toSettings(saved);
});

async function testLlm(l = {}) {
  if (!l.base_url || !l.model) return { ok: false, error: 'LLM endpoint URL and model name are required' };
  try {
    const base = l.base_url.replace(/\/$/, '');
    const res = await fetch(l.api_style === 'openai' ? `${base}/models` : `${base}/api/tags`, {
      headers: l.api_key_enc ? { Authorization: `Bearer ${decrypt(l.api_key_enc)}` } : {},
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? { ok: true, error: null } : { ok: false, error: `LLM endpoint ${res.status}: ${res.statusText}` };
  } catch (err) {
    return { ok: false, error: `LLM endpoint unreachable: ${err.name === 'TimeoutError' ? 'timed out' : err.message}` };
  }
}

// FR-ADM-003: report success or the exact error, for each.
route(admin, 'post', '/admin/settings/test', 'admin', async (_req, user) => {
  const s = await settingsOf(user);
  const j = s.jira ?? {};
  const jira = !j.site_url || !j.token_enc || !j.project_key
    ? { ok: false, error: 'Jira site URL, API token and project key are required' }
    : await testJira(s).then((r) => ({ ok: r.ok, error: r.ok ? null : r.message }));
  return { jira, llm: await testLlm(s.llm) };
});
