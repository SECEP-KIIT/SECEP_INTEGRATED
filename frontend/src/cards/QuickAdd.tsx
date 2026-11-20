import { markDone } from '../onboarding/onboarding'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { createCard, useProjects } from '../api/queries'
import { shellToast } from '../lib/toastBus'
import { uploadAll } from '../files/upload'
import { onQuickAdd, openCard, settled, type QuickAddRequest } from './cardBus'
import { matchProject, parseQuickAdd } from './parseQuickAdd'
import { SOURCES, type Source } from './sourceIcon'



/**
 * Quick-add (FR-CNT-001, decisions item 11): one natural line becomes a user card. Date, time, #project, !urgency and
 * @person turn into chips while typing; the rest is the title. Where the task came from (in person, call, chat) is
 * one click. Opened by the topbar +, `n`, or a paste on the dashboard; Enter adds the card to To do.
 */
export function QuickAddHost() {
  const ref = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [req, setReq] = useState<QuickAddRequest | null>(null)
  const [text, setText] = useState('')
  const [source, setSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projects = useProjects()
  const id = useId()

  useEffect(
    () =>
      onQuickAdd((r) => {
        setReq(r)
        setText(r.text?.trim() ?? '')
        setSource(null)
        setError(null)
        setBusy(false)
      }),
    [],
  )
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (req && !d.open) {
      d.showModal()
      input.current?.focus()
    }
    if (!req && d.open) d.close()
  }, [req])

  const parsed = useMemo(() => parseQuickAdd(text), [text])
  const list = projects.data?.items ?? []
  const fixed = req?.projectId ? list.find((p) => p.id === req.projectId) : undefined
  const tagged = parsed.projects.map((t) => ({ tag: t, project: matchProject(t, list) }))
  const targets = [...new Set([...(fixed ? [fixed.id] : []), ...tagged.flatMap((t) => (t.project ? [t.project.id] : []))])]

  const close = () => {
    settled('quick-add')
    setReq(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!parsed.title || busy) return
    setBusy(true)
    setError(null)
    try {
      const card = await createCard(
        { title: parsed.title.slice(0, 120), due_date: parsed.due_date, due_time: parsed.due_time, urgency: parsed.urgency, source, person: parsed.person },
        targets,
      )
      markDone('quick_add')
      const files = req?.files ?? []
      close()
      // FR-UI-030: pasted or dropped files go on the new card.
      const failed = files.length ? await uploadAll({ type: 'card', id: card.id }, files) : 0
      const attached = files.length - failed
      shellToast(
        `Added "${card.payload.title}" to To do${attached ? ` with ${attached === 1 ? '1 file' : `${attached} files`}` : ''}${failed ? `; ${failed} file${failed === 1 ? '' : 's'} couldn't be attached` : ''}`,
        failed ? 'error' : 'info',
        { label: 'Open', run: () => openCard(card.id) },
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add the card")
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="quick-add" aria-labelledby={`${id}-title`} onClose={close} onClick={(e) => e.target === ref.current && close()}>
      {req && (
        <form onSubmit={(e) => void submit(e)}>
          <h2 id={`${id}-title`} className="sr-only">
            Quick add a card
          </h2>
          <input
            ref={input}
            className="qa-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Send deck to Priya fri 5pm #project !high @priya"
            aria-label="New card"
            aria-describedby={`${id}-chips`}
            maxLength={300}
            autoComplete="off"
          />
          <div className="qa-chips" id={`${id}-chips`} aria-live="polite">
            {fixed && <span className="qa-chip" data-kind="project">#{fixed.name}</span>}
            {parsed.chips.map((c, i) => {
              const miss = c.kind === 'project' && !tagged.find((t) => `#${t.tag}` === c.text)?.project
              return (
                <span key={i} className="qa-chip" data-kind={c.kind} data-miss={miss || undefined} title={miss ? 'No project with that name; it will be left out' : undefined}>
                  {c.kind === 'project' && !miss ? `#${tagged.find((t) => `#${t.tag}` === c.text)!.project!.name}` : c.text}
                  {miss && ' (no such project)'}
                </span>
              )
            })}
            {req.files?.length ? <span className="qa-chip">📎 {req.files.length === 1 ? req.files[0].name : `${req.files.length} files`}</span> : null}
            {!parsed.chips.length && !fixed && !req.files?.length && <span className="qa-hint">Try a date, a time, #project, !high or @person</span>}
          </div>
          <div className="qa-foot">
            <div className="qa-sources" role="radiogroup" aria-label="Where it came from">
              {SOURCES.map(({ key, label, icon: Icon }) => (
                <button key={key} type="button" role="radio" aria-checked={source === key} className="qa-source" onClick={() => setSource(source === key ? null : key)}>
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            <button type="submit" className="primary-button" disabled={!parsed.title || busy}>
              {busy ? 'Adding…' : 'Add card'}
            </button>
          </div>
          {error && (
            <p className="pd-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </dialog>
  )
}
