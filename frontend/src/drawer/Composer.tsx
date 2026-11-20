import { useState, type FormEvent, type ReactNode } from 'react'
import type { ActionType, DecoderActionPayload, JiraPriority, JiraTarget } from '../api/types'

const PRIORITIES: JiraPriority[] = ['Highest', 'High', 'Medium', 'Low']

/** ISO (UTC) → the value of an <input type="datetime-local"> in the user's zone, and back. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

interface Props {
  type: ActionType
  initial: DecoderActionPayload
  submitLabel: string
  busy: boolean
  /** Field errors from a 422 (`details.fields`, keys like "payload.title"). */
  errors: Record<string, string>
  /** Jira issues only: where it goes, prefilled from the email's primary project (`from` names it). */
  jira?: JiraTarget & { from: string | null }
  onSubmit: (payload: DecoderActionPayload, jira?: JiraTarget) => void
  onCancel: () => void
}

/**
 * The ⇧J / Shift+click mini composer (FR-ORC-012, item 10), prefilled from the decoder's proposal. Fields follow the
 * enrich.v1 payload (§6.4): title, description, priority and due date for Jira; start, end and attendees for a
 * calendar event. The issue is always assigned to the user (proposals §12.2), shown read-only, with nothing on the wire.
 * The Jira project and epic are prefilled from the email's primary project and sent as `jira` (proposals §25.2); empty
 * project means the tenant default. The server validates everything again (FR-ORC-002).
 */
export function Composer({ type, initial, submitLabel, busy, errors, jira, onSubmit, onCancel }: Props) {
  const [p, setP] = useState(initial)
  const [key, setKey] = useState(jira?.project_key ?? '')
  const [epic, setEpic] = useState(jira?.epic ?? '')
  const set = <K extends keyof DecoderActionPayload>(k: K, v: DecoderActionPayload[K]) => setP((x) => ({ ...x, [k]: v }))
  const err = (k: string) => errors[`payload.${k}`] ?? errors[k]
  const id = (k: string) => `composer-${type}-${k}`
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const target = type === 'create_jira_issue' ? { project_key: key.trim().toUpperCase() || null, epic: epic.trim().toUpperCase() || null } : undefined
    onSubmit({ ...p, title: p.title?.trim() || null, description: p.description?.trim() || null }, target)
  }

  return (
    <form className="composer" onSubmit={submit} noValidate>
      <Field id={id('title')} label="Title" error={err('title')}>
        <input id={id('title')} value={p.title ?? ''} maxLength={120} required onChange={(e) => set('title', e.target.value)} aria-invalid={!!err('title')} />
      </Field>
      <Field id={id('description')} label="Description" error={err('description')}>
        <textarea id={id('description')} rows={3} maxLength={2000} value={p.description ?? ''} onChange={(e) => set('description', e.target.value)} />
      </Field>
      {type === 'create_jira_issue' && (
        <div className="composer-row">
          <Field id={id('priority')} label="Priority" error={err('priority')}>
            <select id={id('priority')} value={p.priority ?? ''} onChange={(e) => set('priority', (e.target.value || null) as JiraPriority | null)}>
              <option value="">From urgency</option>
              {PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id('due')} label="Due date" error={err('due_date')}>
            <input id={id('due')} type="date" value={p.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)} />
          </Field>
        </div>
      )}
      {type === 'create_jira_issue' && (
        <>
          <div className="composer-row">
            <Field id={id('jira-project')} label="Jira project" error={errors['jira.project_key']}>
              <input id={id('jira-project')} value={key} maxLength={10} placeholder="Default" autoComplete="off" onChange={(e) => setKey(e.target.value)} />
            </Field>
            <Field id={id('jira-epic')} label="Epic" error={errors['jira.epic']}>
              <input id={id('jira-epic')} value={epic} maxLength={20} placeholder="None" autoComplete="off" onChange={(e) => setEpic(e.target.value)} />
            </Field>
          </div>
          <p className="composer-note">
            Assignee: you
            {jira?.from && key.trim().toUpperCase() === (jira.project_key ?? '') && ` · project and epic from ${jira.from}`}
          </p>
        </>
      )}
      {type === 'add_calendar_event' && (
        <>
          <div className="composer-row">
            <Field id={id('start')} label="Starts" error={err('start')}>
              <input id={id('start')} type="datetime-local" value={toLocalInput(p.start)} onChange={(e) => set('start', fromLocalInput(e.target.value))} />
            </Field>
            <Field id={id('end')} label="Ends" error={err('end')}>
              <input id={id('end')} type="datetime-local" value={toLocalInput(p.end)} onChange={(e) => set('end', fromLocalInput(e.target.value))} />
            </Field>
          </div>
          <Field id={id('attendees')} label="Attendees (comma-separated)" error={err('attendees')}>
            <input
              id={id('attendees')}
              value={(p.attendees ?? []).join(', ')}
              onChange={(e) => set('attendees', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              autoComplete="off"
            />
          </Field>
          <p className="composer-note">Times are in your time zone.</p>
        </>
      )}
      <div className="composer-foot">
        <button type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary-button" disabled={busy} aria-busy={busy || undefined}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="composer-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="composer-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
