// Jira Cloud REST v3 (IFR-003): Basic auth with the tenant's account email and API token (decrypted only here),
// 429 + Retry-After honoured (CLAUDE.md), at most 3 attempts. Without Jira settings and with
// SIMULATE_INTEGRATIONS on (the default for the demo), issues get local keys and nothing leaves the host.
import { config } from '../config.js';
import { decrypt } from './crypto.js';

export class JiraError extends Error {
  constructor(status, message, retryable) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

const settingsOf = (tenantSettings) => {
  const j = tenantSettings?.jira;
  return j?.site_url && j?.email && j?.token_enc && j?.project_key ? j : null;
};

async function call(j, method, path, body) {
  const auth = Buffer.from(`${j.email}:${decrypt(j.token_enc)}`).toString('base64');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${j.site_url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return res.status === 204 ? null : res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      const wait = Math.min(Number(res.headers.get('Retry-After')) || attempt * 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    // Jira's own message for 400/401 (shown to the user, FR-ORC-006); never the request body.
    const text = await res.json().then((b) => [...(b.errorMessages ?? []), ...Object.values(b.errors ?? {})].join('; '), () => res.statusText);
    throw new JiraError(res.status, text || res.statusText, retryable);
  }
}

/** Atlassian Document Format for a plain-text description (the masked text only). */
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });

// Simulated keys (no Jira configured): start somewhere time-based so a server restart doesn't hand out the same key again.
let simulated = 100 + (Math.floor(Date.now() / 1000) % 9000);

/** Creates the issue (FR-ORC-003/004). Returns the issue key. */
export async function createIssue(tenantSettings, payload, { projectKey, assigneeEmail } = {}) {
  const j = settingsOf(tenantSettings);
  if (!j) {
    if (!config.simulateIntegrations) throw new JiraError(400, 'Jira is not configured. An admin can add it in Settings.', false);
    return `${projectKey || tenantSettings?.jira?.project_key || 'SECEP'}-${++simulated}`;
  }
  const fields = {
    project: { key: projectKey || j.project_key },
    issuetype: { name: 'Task' },
    summary: payload.title,
    description: adf(payload.description ?? ''),
    ...(payload.priority && { priority: { name: payload.priority } }),
    ...(payload.due_date && { duedate: payload.due_date }),
  };
  // FR-ORC-012: assigned to the user who sent it, when Jira knows them.
  if (assigneeEmail) {
    const users = await call(j, 'GET', `/rest/api/3/user/search?query=${encodeURIComponent(assigneeEmail)}`).catch(() => []);
    if (users?.[0]?.accountId) fields.assignee = { accountId: users[0].accountId };
  }
  const issue = await call(j, 'POST', '/rest/api/3/issue', { fields });
  return issue.key;
}

/** Undo (FR-UI-029): DELETE /rest/api/3/issue/{key}. */
export async function deleteIssue(tenantSettings, key) {
  const j = settingsOf(tenantSettings);
  if (!j) return;
  await call(j, 'DELETE', `/rest/api/3/issue/${encodeURIComponent(key)}`);
}

/** Admin "Test connection" (FR-ADM-003): GET /myself. */
export async function testJira(tenantSettings) {
  const j = settingsOf(tenantSettings);
  if (!j) return { ok: false, message: 'Jira is not configured' };
  try {
    await call(j, 'GET', '/rest/api/3/myself');
    return { ok: true, message: 'Connected' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
