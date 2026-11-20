import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { boardOptions, createCard, deleteCard, isCard, patchCard, setCardsInProject, useProjects } from '../api/queries'
import type { Action, Urgency, UserCardPayload } from '../api/types'
import { shellToast } from '../lib/toastBus'
import { FilesPanel } from '../files/FilesPanel'
import { NotesPanel } from '../notes/NotesPanel'
import { onOpenCard, settled } from './cardBus'
import { CardSend } from './CardSend'
import { SOURCES } from './sourceIcon'

type Card = Action & { payload: UserCardPayload }
const URGENCIES: Urgency[] = ['Critical', 'High', 'Medium', 'Low']

/**
 * A user card's sheet (FR-CNT-002): title, where it came from and who, due date and time, urgency, description,
 * checklist and projects. Every field saves on its own (PATCH /actions/:id {payload}); Delete has Undo. Notes and
 * files join below (FR-CNT-003, -006). The card is read from the board query, so edits from other tabs show live.
 */
export function CardSheetHost({ extra }: { extra?: (card: Card) => ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [cardId, setCardId] = useState<string | null>(null)
  const board = useQuery({ ...boardOptions(), enabled: cardId !== null })
  const found = board.data?.items.find((a) => a.id === cardId)
  const card = found && isCard(found) ? found : null
  const id = useId()

  useEffect(() => onOpenCard((c) => setCardId(c)), [])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (cardId && !d.open) d.showModal()
    if (!cardId && d.open) d.close()
  }, [cardId])

  const close = () => {
    settled('card')
    setCardId(null)
  }

  return (
    <dialog ref={ref} className="card-sheet" aria-labelledby={`${id}-title`} onClose={close} onClick={(e) => e.target === ref.current && close()}>
      {cardId && !card && <p className="col-state">{board.isPending ? 'Loading the card…' : 'This card no longer exists.'}</p>}
      {card && <CardForm key={card.id} card={card} titleId={`${id}-title`} onClose={close} extra={extra?.(card)} />}
    </dialog>
  )
}

function CardForm({ card, titleId, onClose, extra }: { card: Card; titleId: string; onClose: () => void; extra?: ReactNode }) {
  const p = card.payload
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const projects = useProjects()
  const id = useId()

  const save = async (patch: Partial<UserCardPayload>) => {
    setStatus('saving')
    try {
      await patchCard(card, patch)
      setErrors({})
      setStatus('saved')
    } catch (err) {
      const fields = err instanceof ApiError ? ((err.details as { fields?: Record<string, string> } | null)?.fields ?? {}) : {}
      setErrors(Object.keys(fields).length ? fields : { form: err instanceof Error ? err.message : "Couldn't save" })
      setStatus('idle')
    }
  }
  const err = (k: string) =>
    errors[`payload.${k}`] ? (
      <span className="pd-error" role="alert">
        {errors[`payload.${k}`]}
      </span>
    ) : null

  const remove = async () => {
    const snapshot = { ...card.payload }
    const inProjects = card.projects.map((r) => r.id)
    try {
      await deleteCard(card)
      onClose()
      shellToast(`Deleted "${snapshot.title}"`, 'info', { label: 'Undo', run: () => void createCard(snapshot, inProjects) })
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "Couldn't delete the card" })
    }
  }

  const toggleProject = (pid: string, on: boolean) =>
    setCardsInProject(pid, [card.id], on).catch((e: unknown) => setErrors({ form: e instanceof Error ? e.message : "Couldn't change the project" }))

  const SourceIcon = SOURCES.find((s) => s.key === p.source)?.icon
  const checklist = p.checklist
  const done = checklist.filter((i) => i.done).length

  return (
    <div className="cs">
      <header className="cs-head">
        <span className="cs-kind">
          {SourceIcon && <SourceIcon size={14} aria-hidden="true" />}
          Card{p.person ? ` · ${p.person}` : ''}
        </span>
        <span className="cs-status" aria-live="polite">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <h2 id={titleId} className="sr-only">
        {p.title}
      </h2>
      <Blur value={p.title} label="Title" className="cs-title" maxLength={120} onCommit={(v) => v.trim() && v.trim() !== p.title && void save({ title: v.trim() })} />
      {err('title')}

      <div className="cs-row">
        <div className="pd-field">
          <span className="cs-label">From</span>
          <div className="qa-sources" role="radiogroup" aria-label="Where it came from">
            {SOURCES.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" role="radio" aria-checked={p.source === key} className="qa-source" onClick={() => void save({ source: p.source === key ? null : key })}>
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="pd-field">
          <label htmlFor={`${id}-person`}>Person</label>
          <Blur id={`${id}-person`} value={p.person ?? ''} maxLength={120} placeholder="Who asked" onCommit={(v) => (v.trim() || null) !== p.person && void save({ person: v.trim() || null })} />
        </div>
      </div>

      <div className="cs-row">
        <div className="pd-field">
          <label htmlFor={`${id}-date`}>Due date</label>
          <input id={`${id}-date`} type="date" value={p.due_date ?? ''} onChange={(e) => void save(e.target.value ? { due_date: e.target.value } : { due_date: null, due_time: null })} />
          {err('due_date')}
        </div>
        <div className="pd-field">
          <label htmlFor={`${id}-time`}>Time</label>
          <input id={`${id}-time`} type="time" value={p.due_time ?? ''} disabled={!p.due_date} onChange={(e) => void save({ due_time: e.target.value || null })} />
          {err('due_time')}
        </div>
        <div className="pd-field">
          <label htmlFor={`${id}-urg`}>Urgency</label>
          <select id={`${id}-urg`} value={p.urgency ?? ''} onChange={(e) => void save({ urgency: (e.target.value || null) as Urgency | null })}>
            <option value="">None</option>
            {URGENCIES.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="pd-field">
        <label htmlFor={`${id}-desc`}>Description</label>
        <Blur id={`${id}-desc`} multiline value={p.description ?? ''} maxLength={2000} onCommit={(v) => (v.trim() || null) !== p.description && void save({ description: v.trim() || null })} />
        {err('description')}
      </div>

      <section className="cs-section" aria-labelledby={`${id}-check`}>
        <h3 id={`${id}-check`}>
          Checklist {checklist.length > 0 && <span className="col-count">{`${done}/${checklist.length}`}</span>}
        </h3>
        <ul className="cs-checklist">
          {checklist.map((item, i) => (
            <li key={i}>
              <input
                type="checkbox"
                checked={item.done}
                aria-label={item.text}
                onChange={() => void save({ checklist: checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })}
              />
              <span data-done={item.done || undefined}>{item.text}</span>
              <button type="button" className="icon-button" aria-label={`Remove ${item.text}`} onClick={() => void save({ checklist: checklist.filter((_, j) => j !== i) })}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {checklist.length < 50 && (
          <form
            className="cs-add"
            onSubmit={(e) => {
              e.preventDefault()
              const field = e.currentTarget.elements.namedItem('item') as HTMLInputElement
              const text = field.value.trim()
              if (!text) return
              field.value = ''
              void save({ checklist: [...checklist, { text: text.slice(0, 200), done: false }] })
            }}
          >
            <Plus size={14} aria-hidden="true" />
            <input name="item" placeholder="Add an item" aria-label="Add a checklist item" maxLength={200} autoComplete="off" />
          </form>
        )}
        {err('checklist')}
      </section>

      <section className="cs-section" aria-labelledby={`${id}-proj`}>
        <h3 id={`${id}-proj`}>Projects</h3>
        <div className="cs-projects">
          {(projects.data?.items ?? [])
            .filter((pr) => !pr.archived_at || card.projects.some((r) => r.id === pr.id))
            .map((pr) => {
              const on = card.projects.some((r) => r.id === pr.id)
              return (
                <button key={pr.id} type="button" className="cs-project" aria-pressed={on} onClick={() => void toggleProject(pr.id, !on)}>
                  <span className="cs-dot" style={{ background: pr.colour }} aria-hidden="true" />
                  {pr.icon} {pr.name}
                </button>
              )
            })}
          {projects.data?.items.length === 0 && <span className="pd-hint">No projects yet.</span>}
        </div>
      </section>

      <section className="cs-section" aria-labelledby={`${id}-send`}>
        <h3 id={`${id}-send`}>Send to</h3>
        <CardSend card={card} />
      </section>

      <section className="cs-section" aria-labelledby={`${id}-notes`}>
        <h3 id={`${id}-notes`}>Notes</h3>
        <NotesPanel scope={{ type: 'card', id: card.id }} />
      </section>

      <section className="cs-section" aria-labelledby={`${id}-files`}>
        <h3 id={`${id}-files`}>Files</h3>
        <FilesPanel scope={{ type: 'card', id: card.id }} />
      </section>

      {extra}

      {errors.form && (
        <p className="pd-error" role="alert">
          {errors.form}
        </p>
      )}
      <footer className="cs-foot">
        <button type="button" className="ghost-button" onClick={() => void remove()}>
          <Trash2 size={14} aria-hidden="true" />
          Delete card
        </button>
      </footer>
    </div>
  )
}

/** A text field that saves when it loses focus (or on Enter, single line), and follows outside changes. */
function Blur({
  value,
  onCommit,
  multiline = false,
  ...rest
}: { value: string; onCommit: (v: string) => void; multiline?: boolean; id?: string; label?: string; className?: string; maxLength: number; placeholder?: string }) {
  const [v, setV] = useState(value)
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setV(value)
  }
  const props = {
    id: rest.id,
    className: rest.className,
    maxLength: rest.maxLength,
    placeholder: rest.placeholder,
    'aria-label': rest.label,
    value: v,
    onBlur: () => onCommit(v),
  }
  return multiline ? (
    <textarea {...props} rows={3} onChange={(e) => setV(e.target.value)} />
  ) : (
    <input {...props} autoComplete="off" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
  )
}
