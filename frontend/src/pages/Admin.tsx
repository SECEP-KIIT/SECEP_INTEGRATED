import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Cpu, PlugZap, ShieldCheck, Users } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import { useMe } from '../api/queries'
import type { AdminSettings, AdminSettingsInput, AdminUser, ModelView, RoleCategory, SettingsTest } from '../api/types'
import { errorText } from '../inbox/inboxContext'
import './settings.css'
import './admin.css'

const ROLES: RoleCategory[] = ['Executive', 'Manager', 'Engineer', 'Analyst', 'Consultant', 'Client-facing', 'Other']
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError ? (((err.details as { fields?: Record<string, string> } | null)?.fields) ?? {}) : {}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never')

/**
 * Admin (FR-ADM-002–004, FR-ML-011; §6.5 admin routes, all admin-only and 403 otherwise). Connections (Jira and the
 * LLM endpoint, with Test connection), classifier settings, users and their roles, and models (retrain, promote with
 * the gates). Secrets are write-only: the page only knows whether one is set. The audit log stays on Security.
 */
export function Component() {
  const { data: me } = useMe()
  if (me && !me.is_admin) {
    return (
      <div className="settings">
        <p className="col-state">Only admins can open this page.</p>
      </div>
    )
  }
  return (
    <div className="settings admin">
      <SettingsForm />
      <UsersSection />
      <ModelsSection />
    </div>
  )
}

function Section({ icon, title, actions, children }: { icon: ReactNode; title: string; actions?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section className="settings-section" aria-labelledby={id}>
      <div className="admin-head">
        <h2 id={id}>
          {icon}
          {title}
        </h2>
        {actions}
      </div>
      <div className="settings-rows">{children}</div>
    </section>
  )
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="composer-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="settings-hint">{hint}</span>}
      {error && (
        <span className="composer-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

interface Draft {
  site_url: string
  email: string
  project_key: string
  token: string
  base_url: string
  model: string
  api_style: 'ollama' | 'openai'
  api_key: string
  threshold: string
  domains: string
  poll: string
}

const toDraft = (s: AdminSettings): Draft => ({
  site_url: s.jira.site_url ?? '',
  email: s.jira.email ?? '',
  project_key: s.jira.project_key ?? '',
  token: '',
  base_url: s.llm.base_url ?? '',
  model: s.llm.model ?? '',
  api_style: s.llm.api_style,
  api_key: '',
  threshold: String(s.confidence_threshold),
  domains: s.protected_domains.join(', '),
  poll: String(s.poll_interval_s),
})

const toInput = (d: Draft): AdminSettingsInput => ({
  jira: { site_url: d.site_url.trim() || null, email: d.email.trim() || null, project_key: d.project_key.trim().toUpperCase() || null, ...(d.token && { token: d.token }) },
  llm: { base_url: d.base_url.trim() || null, model: d.model.trim() || null, api_style: d.api_style, ...(d.api_key && { api_key: d.api_key }) },
  confidence_threshold: Number(d.threshold),
  protected_domains: d.domains.split(',').map((x) => x.trim()).filter(Boolean),
  poll_interval_s: Number(d.poll),
})

function SettingsForm() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<AdminSettings>('/admin/settings') })
  const [draft, setD] = useState<Draft | null>(null)
  const d = draft ?? (settings.data ? toDraft(settings.data) : null)
  const [test, setTest] = useState<SettingsTest | null>(null)

  const save = useMutation({
    mutationFn: (input: AdminSettingsInput) => api<AdminSettings>('/admin/settings', send('PUT', input)),
    onSuccess: (s) => {
      qc.setQueryData(['admin', 'settings'], s)
      setD(toDraft(s))
    },
  })
  const runTest = useMutation({ mutationFn: () => api<SettingsTest>('/admin/settings/test', send('POST')), onSuccess: setTest })

  if (!d || !settings.data) {
    return (
      <Section icon={<PlugZap size={18} aria-hidden="true" />} title="Connections">
        <p className="col-state">{settings.isError ? "Couldn't load the settings." : 'Loading…'}</p>
      </Section>
    )
  }
  const s = settings.data
  const err = fieldErrors(save.error)
  const e = (k: string) => err[k]
  const set = (k: keyof Draft) => (ev: { target: { value: string } }) => setD({ ...d, [k]: ev.target.value })
  const dirty = JSON.stringify(toInput(d)) !== JSON.stringify(toInput(toDraft(s))) || !!d.token || !!d.api_key
  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    setTest(null)
    save.mutate(toInput(d))
  }

  return (
    <form onSubmit={submit} className="admin-forms" noValidate>
      <Section
        icon={<PlugZap size={18} aria-hidden="true" />}
        title="Connections"
        actions={
          <button type="button" className="ghost-button" disabled={runTest.isPending || dirty} title={dirty ? 'Save first, then test' : undefined} onClick={() => runTest.mutate()}>
            {runTest.isPending ? 'Testing…' : 'Test connection'}
          </button>
        }
      >
        {test && (
          <ul className="admin-test" aria-live="polite">
            <TestLine name="Jira" r={test.jira} />
            <TestLine name="LLM" r={test.llm} />
          </ul>
        )}
        {runTest.isError && <p className="settings-note settings-error">{errorText(runTest.error)}</p>}
        <h3 className="admin-sub">Jira</h3>
        <div className="admin-grid">
          <Field label="Site URL" error={e('jira.site_url')}>{(id) => <input id={id} type="url" value={d.site_url} placeholder="https://yourteam.atlassian.net" onChange={set('site_url')} />}</Field>
          <Field label="Account email" error={e('jira.email')}>{(id) => <input id={id} type="email" value={d.email} onChange={set('email')} />}</Field>
          <Field label="Default project key" error={e('jira.project_key')} hint="Used when an email's project has no Jira project.">
            {(id) => <input id={id} value={d.project_key} maxLength={10} placeholder="ATL" onChange={set('project_key')} />}
          </Field>
          <Field label="API token" error={e('jira.token')} hint={s.jira.token_set ? 'A token is saved. Type a new one only to replace it.' : 'No token saved yet.'}>
            {(id) => <input id={id} type="password" autoComplete="new-password" value={d.token} placeholder={s.jira.token_set ? '••••••••' : ''} onChange={set('token')} />}
          </Field>
        </div>
        <h3 className="admin-sub">LLM endpoint</h3>
        <div className="admin-grid">
          <Field label="Base URL" error={e('llm.base_url')}>{(id) => <input id={id} type="url" value={d.base_url} placeholder="http://localhost:11434" onChange={set('base_url')} />}</Field>
          <Field label="Model" error={e('llm.model')}>{(id) => <input id={id} value={d.model} onChange={set('model')} />}</Field>
          <Field label="API style" error={e('llm.api_style')}>
            {(id) => (
              <select id={id} value={d.api_style} onChange={set('api_style')}>
                <option value="ollama">Ollama</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            )}
          </Field>
          <Field label="API key (optional)" error={e('llm.api_key')} hint={s.llm.api_key_set ? 'A key is saved. Type a new one only to replace it.' : undefined}>
            {(id) => <input id={id} type="password" autoComplete="new-password" value={d.api_key} placeholder={s.llm.api_key_set ? '••••••••' : ''} onChange={set('api_key')} />}
          </Field>
        </div>
      </Section>

      <Section icon={<Bot size={18} aria-hidden="true" />} title="Classifier and polling">
        <div className="admin-grid">
          <Field label="Confidence threshold" error={e('confidence_threshold')} hint="Below this, a label is marked for review.">
            {(id) => <input id={id} type="number" min={0} max={1} step={0.05} value={d.threshold} onChange={set('threshold')} />}
          </Field>
          <Field label="Polling interval (seconds)" error={e('poll_interval_s')}>
            {(id) => <input id={id} type="number" min={10} max={3600} step={5} value={d.poll} onChange={set('poll')} />}
          </Field>
        </div>
        <Field label="Protected domains (comma-separated)" error={e('protected_domains')} hint="Look-alikes of these domains are flagged.">
          {(id) => <input id={id} value={d.domains} placeholder="northwind.example, bank.example" onChange={set('domains')} />}
        </Field>
        <div className="admin-foot">
          {save.isError && Object.keys(err).length === 0 && <span className="settings-note settings-error">{errorText(save.error)}</span>}
          {save.isSuccess && !dirty && <span className="settings-note">Saved.</span>}
          <button type="button" className="text-button" disabled={!dirty || save.isPending} onClick={() => setD(toDraft(s))}>
            Discard
          </button>
          <button type="submit" className="primary-button" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </Section>
    </form>
  )
}

function TestLine({ name, r }: { name: string; r: { ok: boolean; error: string | null } }) {
  return (
    <li data-ok={r.ok || undefined}>
      <span aria-hidden="true">{r.ok ? '✓' : '✕'}</span> {name}: {r.ok ? 'connected' : r.error}
    </li>
  )
}

function UsersSection() {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<{ items: AdminUser[] }>('/admin/users') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] })
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<AdminUser, 'role_category' | 'permissions'>> }) => api<AdminUser>(`/admin/users/${id}`, send('PATCH', body)),
    onSettled: refresh,
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleCategory>('Engineer')
  const [review, setReview] = useState(false)
  const add = useMutation({
    mutationFn: () => api<AdminUser>('/admin/users', send('POST', { email: email.trim(), role_category: role, permissions: review ? ['security.review'] : [] })),
    onSuccess: () => {
      setEmail('')
      setReview(false)
      void refresh()
    },
  })
  const addErr = add.error instanceof ApiError && add.error.code === 'conflict' ? 'That address is already on the list.' : fieldErrors(add.error).email ?? (add.isError ? errorText(add.error) : undefined)

  return (
    <Section icon={<Users size={18} aria-hidden="true" />} title="Users">
      <p className="settings-hint">Only addresses on this list can sign in. Security review lets a user see flagged mail and the audit log.</p>
      {users.data ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Security review</th>
                <th scope="col">Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((u) => {
                const has = u.permissions.includes('security.review')
                return (
                  <tr key={u.id}>
                    <th scope="row">
                      <span className="admin-user">{u.display_name ?? u.email}</span>
                      {u.display_name && <span className="settings-hint">{u.email}</span>}
                      {u.is_admin && <span className="admin-badge">Admin</span>}
                    </th>
                    <td>
                      <select aria-label={`Role of ${u.email}`} value={u.role_category} onChange={(ev) => patch.mutate({ id: u.id, body: { role_category: ev.target.value as RoleCategory } })}>
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Security review for ${u.email}`}
                        checked={has || u.is_admin}
                        disabled={u.is_admin}
                        onChange={() => patch.mutate({ id: u.id, body: { permissions: has ? u.permissions.filter((p) => p !== 'security.review') : [...u.permissions, 'security.review'] } })}
                      />
                    </td>
                    <td>{when(u.last_login_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="col-state">{users.isError ? "Couldn't load the users." : 'Loading…'}</p>
      )}
      {patch.isError && <p className="settings-note settings-error">{errorText(patch.error)}</p>}
      <form
        className="admin-add"
        onSubmit={(ev) => {
          ev.preventDefault()
          add.mutate()
        }}
        noValidate
      >
        <Field label="Add a user (email)" error={addErr}>
          {(id) => <input id={id} type="email" value={email} placeholder="name@company.com" onChange={(ev) => setEmail(ev.target.value)} />}
        </Field>
        <Field label="Role">
          {(id) => (
            <select id={id} value={role} onChange={(ev) => setRole(ev.target.value as RoleCategory)}>
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          )}
        </Field>
        <label className="admin-check">
          <input type="checkbox" checked={review} onChange={(ev) => setReview(ev.target.checked)} /> Security review
        </label>
        <button type="submit" className="primary-button" disabled={!email.trim() || add.isPending}>
          Add
        </button>
      </form>
    </Section>
  )
}

const f1 = (x: number) => x.toFixed(3)

function ModelsSection() {
  const qc = useQueryClient()
  const [waiting, setWaiting] = useState<number | null>(null)
  const models = useQuery({
    queryKey: ['admin', 'models'],
    queryFn: () => api<{ items: ModelView[] }>('/admin/models'),
    // While a retrain runs, poll until the candidate shows up.
    refetchInterval: (q) => (waiting !== null && (q.state.data?.items.length ?? 0) <= waiting ? 5_000 : false),
  })
  const count = models.data?.items.length
  const retraining = waiting !== null && (count === undefined || count <= waiting)
  const retrain = useMutation({ mutationFn: () => api<{ job: string; started_at: string }>('/admin/models/retrain', send('POST')), onSuccess: () => setWaiting(count ?? 0) })
  const [gates, setGates] = useState<{ id: string; list: string[] } | null>(null)
  const promote = useMutation({
    mutationFn: (id: string) => api<ModelView>(`/admin/models/${id}/promote`, send('POST')),
    onMutate: () => setGates(null),
    onError: (err, id) => {
      const list = err instanceof ApiError ? ((err.details as { failed_gates?: string[] } | null)?.failed_gates ?? []) : []
      setGates({ id, list })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'models'] }),
  })
  const promoted = models.data?.items.find((m) => m.status === 'promoted')

  return (
    <Section
      icon={<Cpu size={18} aria-hidden="true" />}
      title="Models"
      actions={
        <button type="button" className="ghost-button" disabled={retrain.isPending || retraining} onClick={() => retrain.mutate()}>
          {retraining ? 'Retraining…' : 'Retrain'}
        </button>
      }
    >
      <p className="settings-hint">
        Retraining uses the corrections people made. A candidate can replace the live model only if its type macro-F1 is no lower and no class
        drops by more than 0.03.
      </p>
      {retrain.isError && <p className="settings-note settings-error">{retrain.error instanceof ApiError && retrain.error.code === 'conflict' ? 'A retrain is already running.' : errorText(retrain.error)}</p>}
      {retraining && <p className="settings-note" aria-live="polite">Retraining. The candidate appears here when it's ready.</p>}
      {models.data ? (
        <div className="admin-table-wrap">
          <table className="admin-table admin-models">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Type F1</th>
                <th scope="col">Urgency F1</th>
                <th scope="col">Sentiment F1</th>
                <th scope="col" title="Expected calibration error: lower is better">ECE</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {models.data.items.map((m) => (
                <tr key={m.id} data-status={m.status}>
                  <th scope="row">
                    <span className="admin-user">{m.version}</span>
                    <span className="admin-status" data-status={m.status}>
                      {m.status === 'promoted' ? '● Live' : m.status === 'candidate' ? '◐ Candidate' : '○ Retired'}
                    </span>
                  </th>
                  <td>
                    {f1(m.metrics.type_macro_f1)}
                    <Delta x={m.metrics.type_macro_f1} base={promoted && m.status === 'candidate' ? promoted.metrics.type_macro_f1 : undefined} />
                  </td>
                  <td>
                    {f1(m.metrics.urgency_macro_f1)}
                    <Delta x={m.metrics.urgency_macro_f1} base={promoted && m.status === 'candidate' ? promoted.metrics.urgency_macro_f1 : undefined} />
                  </td>
                  <td>
                    {f1(m.metrics.sentiment_macro_f1)}
                    <Delta x={m.metrics.sentiment_macro_f1} base={promoted && m.status === 'candidate' ? promoted.metrics.sentiment_macro_f1 : undefined} />
                  </td>
                  <td>{f1(m.metrics.ece)}</td>
                  <td>{when(m.promoted_at ?? m.created_at)}</td>
                  <td>
                    {m.status === 'candidate' && (
                      <button type="button" className="primary-button" disabled={promote.isPending} onClick={() => promote.mutate(m.id)}>
                        <ShieldCheck size={14} aria-hidden="true" /> Promote
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="col-state">{models.isError ? "Couldn't load the models." : 'Loading…'}</p>
      )}
      {gates && (
        <div className="admin-gates" role="alert">
          <p>Not promoted: {gates.list.length ? 'the candidate fails the promotion gates.' : errorText(promote.error)}</p>
          {gates.list.length > 0 && (
            <ul>
              {gates.list.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

function Delta({ x, base }: { x: number; base?: number }) {
  if (base === undefined) return null
  const d = x - base
  if (Math.abs(d) < 0.0005) return <span className="admin-delta">±0</span>
  return (
    <span className="admin-delta" data-dir={d > 0 ? 'up' : 'down'}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(3)}
    </span>
  )
}
