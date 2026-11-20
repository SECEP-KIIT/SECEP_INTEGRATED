// Admin (FR-ADM-002–004, FR-ML-011/012) and security review (§6.5). All routes here need admin or security.review.
import type { ConfidenceBin, EmailType, RoleCategory, Sentiment, Urgency } from '../../api/types'
import { control, scaled } from '../control'
import { page } from '../http/cursor'
import { Fail, route } from '../http/route'
import { isEmail, isInt, isOptStr, object, type Fields } from '../http/validate'
import { audit } from '../store/audit'
import { changed, db, userById } from '../store/db'
import { toLink, toListItem, toModel, toSettings, toUser } from '../store/serialize'
import type { ModelRow, SettingsRow } from '../store/types'

const ROLES: RoleCategory[] = ['Executive', 'Manager', 'Engineer', 'Analyst', 'Consultant', 'Client-facing', 'Other']
const PERMISSIONS = ['security.review']
const TYPES: EmailType[] = ['Task', 'Info', 'Credentials', 'Meeting', 'Approval']

function checkSection(f: Fields, name: 'jira' | 'llm', value: unknown, keys: Record<string, (v: unknown) => boolean>) {
  if (value === undefined) return
  if (typeof value !== 'object' || value === null) return f.add(name, 'Must be an object')
  for (const [k, v] of Object.entries(value)) {
    if (!keys[k]) f.add(`${name}.${k}`, 'Unknown field')
    else if (!keys[k](v)) f.add(`${name}.${k}`, 'Invalid value')
  }
}

/** FR-ML-012 promotion gates: type macro-F1 not lower, and no class F1 drops by more than 0.03. */
export function failedGates(candidate: ModelRow, promoted: ModelRow | undefined): string[] {
  if (!promoted) return []
  const gates: string[] = []
  if (candidate.metrics.type_macro_f1 < promoted.metrics.type_macro_f1) {
    gates.push(`type macro-F1 ${candidate.metrics.type_macro_f1} is below the promoted ${promoted.metrics.type_macro_f1}`)
  }
  for (const [cls, f1] of Object.entries(promoted.metrics.per_class_f1)) {
    const drop = f1 - (candidate.metrics.per_class_f1[cls] ?? 0)
    if (drop > 0.03) gates.push(`${cls} F1 drops by ${drop.toFixed(3)} (limit 0.03)`)
  }
  return gates
}

let retrainRunning = false

export const adminRoutes = [
  route('get', '/admin/settings', 'admin', () => toSettings(db.settings)),

  route('put', '/admin/settings', 'admin', async ({ user, body }) => {
    const f = object(body).only(['jira', 'llm', 'confidence_threshold', 'protected_domains', 'poll_interval_s'])
    const url = (v: unknown) => v === null || (typeof v === 'string' && /^https?:\/\/\S+$/.test(v) && v.length <= 500)
    checkSection(f, 'jira', f.body.jira, {
      site_url: url, email: (v) => v === null || isEmail(v), project_key: (v) => v === null || (typeof v === 'string' && /^[A-Z][A-Z0-9]{1,9}$/.test(v)),
      token: (v) => typeof v === 'string' && v.length > 0 && v.length <= 500, token_set: () => true,
    })
    checkSection(f, 'llm', f.body.llm, {
      base_url: url, model: (v) => isOptStr(v, 200), api_style: (v) => v === 'ollama' || v === 'openai',
      api_key: (v) => typeof v === 'string' && v.length <= 500, api_key_set: () => true,
    })
    if ('confidence_threshold' in f.body && !(typeof f.body.confidence_threshold === 'number' && f.body.confidence_threshold >= 0 && f.body.confidence_threshold <= 1)) {
      f.add('confidence_threshold', 'Must be between 0 and 1')
    }
    if ('protected_domains' in f.body && !(Array.isArray(f.body.protected_domains) && f.body.protected_domains.every((d) => typeof d === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))) {
      f.add('protected_domains', 'Must be a list of domains')
    }
    if ('poll_interval_s' in f.body && !isInt(f.body.poll_interval_s, 10, 3600)) f.add('poll_interval_s', 'Must be 10–3600 seconds')
    f.done()

    const b = f.body as Partial<{ jira: Partial<SettingsRow['jira']>; llm: Partial<SettingsRow['llm']> }> & Partial<SettingsRow>
    const { token_set: _t, ...jira } = (b.jira ?? {}) as Record<string, unknown>
    const { api_key_set: _k, ...llm } = (b.llm ?? {}) as Record<string, unknown>
    db.settings = {
      ...db.settings,
      ...(b.confidence_threshold !== undefined && { confidence_threshold: b.confidence_threshold }),
      ...(b.protected_domains !== undefined && { protected_domains: b.protected_domains }),
      ...(b.poll_interval_s !== undefined && { poll_interval_s: b.poll_interval_s }),
      // Secrets are write-only: stored when given, never echoed back (§6.4.1).
      jira: { ...db.settings.jira, ...jira },
      llm: { ...db.settings.llm, ...llm },
    }
    // Which settings changed, never their values (secrets especially).
    await audit(user.id, 'settings.update', 'tenant', { changed: Object.keys(f.body) })
    changed()
    return toSettings(db.settings)
  }),

  // FR-ADM-003: report success or the exact error.
  route('post', '/admin/settings/test', 'admin', () => {
    const j = db.settings.jira
    const jiraError = !j.site_url || !j.token || !j.project_key
      ? 'Jira site URL, API token and project key are required'
      : control.jiraMode === 'unauthorized' ? 'Jira 401: Client must be authenticated to access this resource.'
      : control.jiraMode === 'server_error' ? 'Jira 503: Service temporarily unavailable.'
      : null
    const l = db.settings.llm
    const llmError = !l.base_url || !l.model ? 'LLM endpoint URL and model name are required' : null
    return { jira: { ok: !jiraError, error: jiraError }, llm: { ok: !llmError, error: llmError } }
  }),

  route('get', '/admin/users', 'admin', () => ({ items: db.users.map(toUser) })),

  // FR-ADM-004: allow-list an address with a role category and permissions.
  route('post', '/admin/users', 'admin', ({ body }) => {
    const f = object(body).only(['email', 'role_category', 'permissions'])
    if (!isEmail(f.body.email)) f.add('email', 'Must be an email address')
    if (!ROLES.includes(f.body.role_category as RoleCategory)) f.add('role_category', 'Unknown role category')
    if (!(Array.isArray(f.body.permissions) && f.body.permissions.every((p) => PERMISSIONS.includes(p)))) f.add('permissions', 'Unknown permission')
    f.done()
    const email = (f.body.email as string).toLowerCase()
    if (db.users.some((u) => u.email === email)) throw new Fail(409, 'conflict', 'User already exists')
    const u = { id: crypto.randomUUID(), email, display_name: null, role_category: f.body.role_category as RoleCategory, is_admin: false, permissions: f.body.permissions as string[], last_login_at: null, ui_prefs: {}, mailbox: null }
    db.users.push(u)
    db.reads.set(u.id, new Set())
    changed()
    return toUser(u)
  }, { status: 201 }),

  route<{ id: string }>('patch', '/admin/users/:id', 'admin', ({ params, body }) => {
    const u = userById(params.id)
    if (!u) throw new Fail(404, 'not_found', 'User not found')
    const f = object(body).only(['role_category', 'permissions'])
    if ('role_category' in f.body && !ROLES.includes(f.body.role_category as RoleCategory)) f.add('role_category', 'Unknown role category')
    if ('permissions' in f.body && !(Array.isArray(f.body.permissions) && f.body.permissions.every((p) => PERMISSIONS.includes(p)))) f.add('permissions', 'Unknown permission')
    f.done()
    if (f.body.role_category) u.role_category = f.body.role_category as RoleCategory
    if (f.body.permissions) u.permissions = [...(f.body.permissions as string[])]
    changed()
    return toUser(u)
  }),

  route('get', '/admin/models', 'admin', () => ({ items: [...db.models].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toModel) })),

  // FR-ML-011. Working assumption until the SRS change: M6 asks M1 to retrain, and the candidate shows up later.
  route('post', '/admin/models/retrain', 'admin', () => {
    if (retrainRunning) throw new Fail(409, 'conflict', 'A retrain is already running')
    retrainRunning = true
    const started_at = new Date().toISOString()
    setTimeout(() => {
      const base = db.models.find((m) => m.status === 'promoted')!.metrics
      const corrections = db.corrections.length
      const lift = Math.min(0.04, 0.01 + corrections * 0.002)
      const version = `triage-${started_at.slice(0, 16).replace(/[-:T]/g, '')}`
      db.models.push({
        id: crypto.randomUUID(), version, status: 'candidate', created_at: new Date().toISOString(), promoted_at: null,
        metrics: {
          type_macro_f1: +(base.type_macro_f1 + lift).toFixed(3),
          urgency_macro_f1: +(base.urgency_macro_f1 + lift / 2).toFixed(3),
          sentiment_macro_f1: +(base.sentiment_macro_f1 + lift / 3).toFixed(3),
          per_class_f1: Object.fromEntries(Object.entries(base.per_class_f1).map(([c, v]) => [c, +(v + lift).toFixed(3)])),
          ece: +(base.ece - 0.004).toFixed(3),
        },
      })
      retrainRunning = false
      changed()
    }, scaled(20_000))
    return { job: 'retrain', started_at }
  }, { status: 202 }),

  route<{ id: string }>('post', '/admin/models/:id/promote', 'admin', async ({ user, params }) => {
    const candidate = db.models.find((m) => m.id === params.id)
    if (!candidate) throw new Fail(404, 'not_found', 'Model not found')
    if (candidate.status !== 'candidate') throw new Fail(409, 'conflict', 'Only candidates can be promoted', { failed_gates: [] })
    const promoted = db.models.find((m) => m.status === 'promoted')
    const gates = failedGates(candidate, promoted)
    if (gates.length) throw new Fail(409, 'conflict', 'Candidate fails the promotion gates', { failed_gates: gates })
    if (promoted) promoted.status = 'retired'
    candidate.status = 'promoted'
    candidate.promoted_at = new Date().toISOString()
    await audit(user.id, 'model.promote', candidate.id, { version: candidate.version, replaced: promoted?.version ?? null })
    changed()
    return toModel(candidate)
  }),

  route('get', '/admin/metrics', 'admin', ({ url }) => {
    const days = url.searchParams.get('days') === null ? 30 : Number(url.searchParams.get('days'))
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Fail(400, 'bad_request', 'days must be 1–365')
    const since = Date.now() - days * 86_400_000
    const emails = [...db.emails.values()].filter((e) => e.triage && Date.parse(e.received_at) >= since)
    const corrections = db.corrections.filter((c) => Date.parse(c.created_at) >= since)
    type Head = 'email_type' | 'urgency' | 'sentiment'
    const label = (e: (typeof emails)[number], h: Head) => e.triage![h].label as string
    const histogram = (h: Head): ConfidenceBin[] => {
      const bins = Array.from({ length: 10 }, (_, i) => ({ bin_start: i / 10, bin_end: (i + 1) / 10, count: 0 }))
      for (const e of emails) bins[Math.min(9, Math.floor(e.triage![h].confidence * 10))].count++
      return bins
    }
    const head = <L extends string>(h: Head, labels: readonly L[]) => {
      const n = (l: L) => emails.filter((e) => label(e, h) === l).length
      const fixed = (l: L) => corrections.filter((c) => c.field === h && c.old_label === l).length
      return {
        volume: Object.fromEntries(labels.map((l) => [l, n(l)])) as Record<L, number>,
        override_rate: Object.fromEntries(labels.map((l) => [l, n(l) ? +(fixed(l) / n(l)).toFixed(4) : 0])) as Record<L, number>,
        confidence_histogram: histogram(h),
      }
    }
    const type = head('email_type', TYPES)
    return {
      window_days: days,
      volume_by_type: type.volume,
      override_rate_by_class: type.override_rate,
      confidence_histogram: type.confidence_histogram,
      urgency: head<Urgency>('urgency', ['Low', 'Medium', 'High', 'Critical']),
      sentiment: head<Sentiment>('sentiment', ['Positive', 'Neutral', 'Negative', 'Frustrated']),
    }
  }),

  // Security review (§6.5): flagged emails across the tenant, and the audit log.
  route('get', '/security/flags', 'security.review', ({ url }) =>
    page(
      url,
      [...db.emails.values()]
        .filter((e) => e.security_flag !== 'none')
        .sort((a, b) => b.received_at.localeCompare(a.received_at))
        .map((e) => ({ ...toListItem(db, e), links: db.urlChecks.filter((c) => c.email_id === e.id).map(toLink) })),
    ),
  ),

  route('get', '/audit', 'security.review', ({ url }) =>
    page(
      url,
      [...db.audit].reverse().map((a) => {
        const actor = a.actor_user_id ? userById(a.actor_user_id) : undefined
        return {
          id: a.id, created_at: a.created_at, actor: actor ? { id: actor.id, email: actor.email } : null,
          event: a.event, target: a.target, details: structuredClone(a.details), hash: a.hash, prev_hash: a.prev_hash,
        }
      }),
    ),
  ),
]
