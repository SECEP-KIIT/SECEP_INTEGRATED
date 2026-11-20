import { LayoutList, Pencil, Plus, Undo2, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { acceptAction, createAction, rejectAction, undoAction, useProjects } from '../api/queries'
import type { Action, ActionType, DecoderActionPayload, EmailDetail, JiraPriority, JiraTarget, Urgency } from '../api/types'
import { UNDO_MS, errorText, type OpenOptions } from '../inbox/inboxContext'
import { shellToast } from '../lib/toastBus'
import { Composer } from './Composer'

const TYPE_LABEL: Record<ActionType, string> = { create_jira_issue: 'Jira issue', add_calendar_event: 'Calendar event', add_board_card: 'Board card' }
const SEND_LABEL: Record<ActionType, string> = { create_jira_issue: 'Send to Jira', add_calendar_event: 'Add to calendar', add_board_card: 'Add to board' }
/** FR-ORC-004, for prefilling the composer only; the server applies the same mapping when priority is left empty. */
const PRIORITY_FOR: Record<Urgency, JiraPriority> = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' }

const EMPTY: DecoderActionPayload = { title: null, description: null, priority: null, due_date: null, start: null, end: null, attendees: null }

function TypeGlyph({ type }: { type: ActionType }) {
  const Icon = type === 'create_jira_issue' ? Zap : LayoutList
  return <Icon size={16} aria-hidden="true" />
}

/** Only the fields that differ from the proposal: "send the proposal as is" plus the user's edits (FR-ORC-012). */
function diff(from: DecoderActionPayload, to: DecoderActionPayload): Partial<DecoderActionPayload> {
  const out: Partial<DecoderActionPayload> = {}
  for (const k of Object.keys(to) as (keyof DecoderActionPayload)[]) {
    if (JSON.stringify(from[k]) !== JSON.stringify(to[k])) (out as Record<string, unknown>)[k] = to[k]
  }
  return out
}

type Target = JiraTarget & { from: string | null }

/**
 * FR-ORC-012 / FR-UI-017: the Jira target shown before sending, from the email's primary project (its Jira project and
 * epic); none → the tenant default, which the server fills in (proposals §25.2).
 */
function useJiraTarget(email: EmailDetail): Target {
  const { data } = useProjects()
  const primary = email.projects.find((p) => p.is_primary)
  const p = primary && data?.items.find((x) => x.id === primary.id)
  return p?.jira_project_key ? { project_key: p.jira_project_key, epic: p.jira_epic, from: p.name } : { project_key: null, epic: null, from: null }
}

const targetText = (t: Target) => `to ${t.project_key ?? 'the default project'}${t.epic ? ` › ${t.epic}` : ''}`

const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError && (err.code === 'validation_failed' || err.code === 'action_invalid')
    ? (((err.details as { fields?: Record<string, string> } | null)?.fields) ?? {})
    : {}

/**
 * FR-UI-029: when each sent action's undo window closes. Module-level on purpose: a new action's row mounts (via the
 * websocket event) before its accept call returns, so the window cannot live in the row's own state.
 */
const undoWindows = new Map<string, number>()

/** After a send: open the undo window and say so in a toast (Ctrl/⌘+Z runs its Undo), or report the failure. */
function reportSent(done: Action) {
  if (done.status === 'done') {
    undoWindows.set(done.id, Date.now() + UNDO_MS)
    shellToast(done.type === 'create_jira_issue' ? `Created ${done.external_ref ?? 'the Jira issue'}` : 'Sent', 'info', {
      label: 'Undo',
      run: () => void undoAction(done),
    })
  } else if (done.status === 'failed') {
    shellToast(`Couldn't send it: ${done.error ?? 'the action failed'}`, 'error')
  }
}

/** The in-row "Undo · 9 s" button; disappears when the window closes. */
function UndoButton({ id, busy, onUndo }: { id: string; busy: boolean; onUndo: () => void }) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => {
      const s = Math.ceil(((undoWindows.get(id) ?? 0) - Date.now()) / 1000)
      if (s > 0) setLeft(s)
      else {
        undoWindows.delete(id)
        setLeft(null)
      }
    }
    tick()
    const t = window.setInterval(tick, 250)
    return () => window.clearInterval(t)
  }, [id])
  if (left === null) return null
  return (
    <button type="button" className="ghost-button" disabled={busy} onClick={onUndo}>
      <Undo2 size={14} aria-hidden="true" /> Undo · {left} s
    </button>
  )
}

/**
 * The drawer's Proposed actions section (item 10). Each action shows its state, live: proposed → executing → done
 * (with the issue key) or failed (with Jira's error and Retry). Nothing executes without the owner's click
 * (FR-ORC-002). Jira and Calendar are simulated by the mock (fake keys, fake events).
 */
export function ActionList({ email, compose }: { email: EmailDetail; compose?: OpenOptions['compose'] }) {
  // Calendar is v2 (19 Nov 2026): the decoder's calendar proposals stay in the data but are not shown.
  const shown = email.actions.filter((a) => a.type !== 'add_calendar_event')
  const live = shown.filter((a) => a.status !== 'rejected')
  const declined = shown.length - live.length
  const has = (type: ActionType) => live.some((a) => a.type === type)
  // ⇧-click or "no proposal": edit the existing one of that type, or start a new one.
  const editFirst = compose ? live.find((a) => a.type === compose && (a.status === 'proposed' || a.status === 'failed'))?.id : undefined
  const [creating, setCreating] = useState<OpenOptions['compose']>(compose && !editFirst ? compose : undefined)
  const target = useJiraTarget(email)

  return (
    <div className="actions">
      {live.length === 0 && !creating && <p className="drawer-muted">No proposed actions for this email.</p>}
      <ul className="action-list">
        {live.map((a) => (
          <ActionRow key={a.id} action={a} target={target} startEditing={a.id === editFirst} />
        ))}
      </ul>
      {declined > 0 && <p className="drawer-muted">{declined === 1 ? '1 declined proposal' : `${declined} declined proposals`}</p>}

      {creating ? (
        <NewAction email={email} type={creating} onDone={() => setCreating(undefined)} />
      ) : (
        <div className="action-new">
          {!has('create_jira_issue') && !email.jira_key && (
            <button type="button" className="ghost-button" onClick={() => setCreating('create_jira_issue')}>
              <Plus size={14} aria-hidden="true" /> Jira issue
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ActionRow({ action, target, startEditing }: { action: Action; target: Target; startEditing: boolean }) {
  const [editing, setEditing] = useState(startEditing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const p = action.payload as DecoderActionPayload
  const open = action.status === 'proposed' || action.status === 'failed'

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setEditing(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const send = (fn: () => Promise<Action>) => run(async () => reportSent(await fn()))
  const undo = () =>
    run(async () => {
      await undoAction(action)
      undoWindows.delete(action.id)
    })

  return (
    <li className="action" data-status={action.status}>
      <div className="action-head">
        <TypeGlyph type={action.type} />
        <div className="action-text">
          <p className="action-title">{p.title ?? TYPE_LABEL[action.type]}</p>
          <p className="action-meta">
            {TYPE_LABEL[action.type]}
            {p.priority && ` · ${p.priority} priority`}
            {p.due_date && ` · due ${new Date(`${p.due_date}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
            {p.start && ` · ${new Date(p.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            {action.type === 'create_jira_issue' && (action.status === 'proposed' || action.status === 'failed') && ` · ${targetText(target)}`}
            {action.origin === 'user' && ' · added by you'}
          </p>
        </div>
        <ActionStatus action={action} />
      </div>

      {action.status === 'failed' && action.error && (
        <p className="action-error" role="alert">
          {action.error}
        </p>
      )}
      {error !== null && (!editing || Object.keys(fieldErrors(error)).length === 0) && (
        <p className="action-error" role="alert">
          {errorText(error)}
        </p>
      )}

      {editing ? (
        <Composer
          type={action.type}
          initial={{ ...EMPTY, ...p }}
          submitLabel={SEND_LABEL[action.type]}
          busy={busy}
          errors={fieldErrors(error)}
          jira={target}
          onCancel={() => setEditing(false)}
          onSubmit={(next, jira) => send(() => acceptAction(action, diff({ ...EMPTY, ...p }, next), jira))}
        />
      ) : open ? (
        <div className="action-buttons">
          <button type="button" className="primary-button" disabled={busy} aria-busy={busy || undefined} onClick={() => send(() => acceptAction(action))}>
            {action.status === 'failed' ? 'Retry' : SEND_LABEL[action.type]}
          </button>
          <button type="button" className="ghost-button" disabled={busy} onClick={() => setEditing(true)}>
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={() => run(() => rejectAction(action))}>
            Decline
          </button>
        </div>
      ) : (
        action.status === 'done' &&
        undoWindows.has(action.id) && (
          <div className="action-buttons">
            <UndoButton id={action.id} busy={busy} onUndo={undo} />
          </div>
        )
      )}
    </li>
  )
}

/** Status in words plus a mark, never colour alone. Done Jira issues show their key with a drawn check (item 9). */
function ActionStatus({ action }: { action: Action }) {
  switch (action.status) {
    case 'proposed':
      return <span className="action-status">Proposed</span>
    case 'accepted':
    case 'executing':
      return (
        <span className="action-status" data-tone="busy">
          Sending…
        </span>
      )
    case 'failed':
      return (
        <span className="action-status" data-tone="error">
          Failed
        </span>
      )
    case 'rejected':
      return <span className="action-status">Declined</span>
    case 'done':
      return (
        <span className="action-status" data-tone="ok">
          <svg className="check-draw" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2.5 7.5l3 3 6-7" pathLength="100" />
          </svg>
          {action.type === 'create_jira_issue'
            ? `${action.external_ref}${action.external_status ? ` · ${action.external_status}` : ''}`
            : action.type === 'add_calendar_event'
              ? 'In your calendar'
              : 'On the board'}
        </span>
      )
  }
}

/** A manual action (POST /emails/:id/actions), then accepted right away, which is what "Send" means to the user. */
function NewAction({ email, type, onDone }: { email: EmailDetail; type: NonNullable<OpenOptions['compose']>; onDone: () => void }) {
  const target = useJiraTarget(email)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const initial: DecoderActionPayload = {
    ...EMPTY,
    title: (email.subject ?? '').slice(0, 120) || null,
    description: email.summary_short,
    ...(type === 'create_jira_issue'
      ? { priority: email.triage ? PRIORITY_FOR[email.triage.urgency.label] : null, due_date: email.due_date }
      : { attendees: [email.from.address] }),
  }

  const submit = async (payload: DecoderActionPayload, jira?: JiraTarget) => {
    setBusy(true)
    setError(null)
    try {
      const created = await createAction(email.id, type, payload)
      const result = await acceptAction(created, undefined, jira)
      reportSent(result)
      onDone()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="action action-creating">
      <p className="action-title">
        <TypeGlyph type={type} /> New {TYPE_LABEL[type].toLowerCase()}
      </p>
      {error !== null && Object.keys(fieldErrors(error)).length === 0 && (
        <p className="action-error" role="alert">
          {errorText(error)}
        </p>
      )}
      <Composer type={type} initial={initial} submitLabel={SEND_LABEL[type]} busy={busy} errors={fieldErrors(error)} jira={target} onSubmit={submit} onCancel={onDone} />
    </div>
  )
}
