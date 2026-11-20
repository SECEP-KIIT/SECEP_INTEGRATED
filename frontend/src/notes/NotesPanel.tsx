import { useQuery } from '@tanstack/react-query'
import { Paperclip, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createNote, deleteFile, deleteNote, MAX_FILE_BYTES, notesOptions, patchNote, uploadFile, type FileScope, type NoteScope } from '../api/queries'
import type { FileRef, Note } from '../api/types'
import { shellToast } from '../lib/toastBus'
import { useMinuteClock } from '../shell/useMinuteClock'
import { Markdown } from './markdown'
import { NoteFile } from './NoteFile'
import { NoteFilesContext } from './noteFilesContext'
import { toggleTask } from './markdownModel'
import './notes.css'

interface Props {
  scope: NoteScope
  /** → Card / → Jira on each open checkbox line. */
  taskTools?: (text: string) => ReactNode
}

/**
 * The notes on an email, card or project, or the standalone ones (FR-CNT-003). Markdown-lite, rendered until
 * clicked, saved with Save (Ctrl+Enter); unsaved text is kept if the drawer closes, with "edited 2 min ago".
 */
export function NotesPanel({ scope, taskTools }: Props) {
  const notes = useQuery(notesOptions(scope))
  const [draft, setDraft] = useState<string | null>(null)

  if (notes.isPending) return <p className="drawer-muted">Loading notes…</p>
  if (notes.isError)
    return (
      <p className="drawer-muted" role="alert">
        Couldn't load notes.{' '}
        <button type="button" className="text-button" onClick={() => void notes.refetch()}>
          Try again
        </button>
      </p>
    )
  return (
    <div className="notes">
      {draft === null && (
        <button type="button" className="ghost-button notes-add" onClick={() => setDraft('')}>
          <Plus size={14} aria-hidden="true" />
          Add a note
        </button>
      )}
      {draft !== null && <NoteEditor key="draft" scope={scope} note={null} initial={draft} autoFocus onSettled={() => setDraft(null)} taskTools={taskTools} />}
      {notes.data.map((n) => (
        <NoteEditor key={n.id} scope={scope} note={n} initial={n.body} taskTools={taskTools} />
      ))}
    </div>
  )
}

function ago(iso: string, now: Date) {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000))
  if (min < 1) return 'edited just now'
  if (min < 60) return `edited ${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `edited ${h} h ago`
  return `edited ${new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

/** The `[file:<id>]` tokens in a note body, in order, once each. */
const fileIds = (text: string) => [...new Set([...text.matchAll(/\[file:([0-9a-f-]{36})\]/g)].map((m) => m[1]))]

export function NoteEditor({
  scope,
  note,
  initial,
  autoFocus = false,
  onSettled,
  taskTools,
}: {
  scope: NoteScope
  note: Note | null
  initial: string
  autoFocus?: boolean
  onSettled?: () => void
  taskTools?: (text: string) => ReactNode
}) {
  const [text, setText] = useState(initial)
  const [editing, setEditing] = useState(autoFocus)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const now = useMinuteClock()
  const area = useRef<HTMLTextAreaElement>(null)
  const id = useRef(note?.id ?? null)
  const [exists, setExists] = useState(!!note)
  // The body last saved; `text` differs from it while there are unsaved changes.
  const [base, setBase] = useState(initial)
  const sent = useRef(initial)
  const latest = useRef(text)
  useEffect(() => {
    latest.current = text
  }, [text])

  const [savedAt, setSavedAt] = useState<string | null>(note?.updated_at ?? null)
  // Another tab or a toggle changed it while not editing: follow the server.
  const [lastBody, setLastBody] = useState(note?.body)
  if (note && note.body !== lastBody) {
    setLastBody(note.body)
    setSavedAt(note.updated_at)
    if (!editing) {
      setText(note.body)
      setBase(note.body)
    }
  }

  // Saves run one after another, so a second save never creates the note twice while the first is in flight.
  const scopeRef = useRef(scope)
  useEffect(() => {
    scopeRef.current = scope
  })
  const chain = useRef<Promise<boolean>>(Promise.resolve(true))
  const save = useCallback((body: string) => {
    const run = async () => {
      if (body === sent.current && id.current) return true
      if (!id.current && !body.trim()) return true
      setStatus('saving')
      try {
        const saved = id.current ? await patchNote(scopeRef.current, id.current, body) : await createNote(scopeRef.current, body)
        id.current = saved.id
        setExists(true)
        sent.current = saved.body
        setBase(saved.body)
        setSavedAt(saved.updated_at)
        setStatus('idle')
        return true
      } catch {
        setStatus('error')
        return false
      }
    }
    const p = chain.current.then(run)
    chain.current = p
    return p
  }, [])

  useEffect(() => {
    if (editing) area.current?.focus()
  }, [editing])
  // Closing the drawer or leaving the page with unsaved text keeps it rather than losing it.
  useEffect(() => () => void save(latest.current), [save])

  // Files attached while editing; Cancel removes them again.
  const fresh = useRef<FileRef[]>([])
  const dirty = text !== base

  const done = async () => {
    if (!(await save(text))) return
    fresh.current = []
    if (onSettled) onSettled()
    else setEditing(false)
  }
  const cancel = () => {
    const scopeNow = fileScope
    if (scopeNow) for (const f of fresh.current) void deleteFile(scopeNow, f).catch(() => {})
    fresh.current = []
    latest.current = sent.current
    setText(sent.current)
    setAttachError(null)
    if (onSettled) onSettled()
    else setEditing(false)
  }

  // A file attached inside this note is stored on the note's own email, card or project and referenced as [file:<id>].
  // It goes into the text; the note itself is saved on Save.
  const fileScope: FileScope | null = scope ? { type: scope.type, id: scope.id } : null
  const input = useRef<HTMLInputElement>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const attach = async (list: FileList | null) => {
    if (!fileScope || !list?.length) return
    setAttachError(null)
    setEditing(true)
    const tokens: string[] = []
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) {
        setAttachError('Over 25 MB')
        continue
      }
      try {
        const ref = await uploadFile(fileScope, f)
        fresh.current.push(ref)
        tokens.push(`[file:${ref.id}]`)
      } catch {
        setAttachError("Couldn't attach")
      }
    }
    if (!tokens.length) return
    const cur = latest.current
    const next = `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${tokens.join(' ')}`
    latest.current = next
    setText(next)
  }

  const remove = async () => {
    if (!note && !id.current) {
      cancel()
      return
    }
    const body = text
    const target = note ?? ({ id: id.current } as Note)
    await deleteNote(scope, target).catch(() => setStatus('error'))
    latest.current = sent.current
    onSettled?.()
    shellToast('Note deleted', 'info', { label: 'Undo', run: () => void createNote(scope, body) })
  }

  const statusText =
    status === 'saving' ? 'Saving…' : status === 'error' ? "Couldn't save. Try again." : editing && dirty ? 'Unsaved changes' : savedAt ? ago(savedAt, now) : 'Not saved yet'

  return (
    <NoteFilesContext.Provider value={fileScope}>
      <article className="note" data-editing={editing || undefined}>
        {editing ? (
          <>
            <textarea
              ref={area}
              className="note-input"
              value={text}
              rows={Math.min(14, Math.max(4, text.split('\n').length + 1))}
              maxLength={20_000}
              aria-label="Note"
              placeholder="Jot down what you want to see before the meeting…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void done()
                } else if (e.key === 'Escape') {
                  // Escape never throws text away: it only closes an unchanged note.
                  e.stopPropagation()
                  if (!dirty) cancel()
                }
              }}
            />
            {fileIds(text).length > 0 && (
              <div className="note-files">
                {fileIds(text).map((fid) => (
                  <NoteFile key={fid} id={fid} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div
            className="note-view"
            role="button"
            tabIndex={0}
            aria-label="Edit note"
            onClick={(e) => !(e.target as HTMLElement).closest('a, button, input') && setEditing(true)}
            onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && setEditing(true)}
          >
            {text.trim() ? (
              <Markdown
                body={text}
                taskTools={taskTools}
                onToggle={(line) => {
                  const next = toggleTask(text, line)
                  setText(next)
                  void save(next)
                }}
              />
            ) : (
              <span className="drawer-muted">Empty note</span>
            )}
          </div>
        )}
        <footer className="note-foot">
          {fileScope && (
            <>
              <button type="button" className="icon-button" aria-label="Attach a file to this note" title="Attach a file to this note" onClick={() => input.current?.click()}>
                <Paperclip size={13} aria-hidden="true" />
              </button>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void attach(e.target.files)
                  e.target.value = ''
                }}
              />
            </>
          )}
          <span className="drawer-muted" aria-live="polite">
            {attachError ? `${attachError}. ` : ''}
            {statusText}
          </span>
          {editing && (
            <>
              <button type="button" className="text-button" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="primary-button note-save" disabled={status === 'saving' || (!dirty && exists) || (!exists && !text.trim())} onClick={() => void done()}>
                Save
              </button>
            </>
          )}
          <button type="button" className="icon-button" aria-label="Delete note" onClick={() => void remove()}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </footer>
      </article>
    </NoteFilesContext.Provider>
  )
}
