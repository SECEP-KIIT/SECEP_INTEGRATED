import { useQuery } from '@tanstack/react-query'
import { Download, FileText, Image as ImageIcon, Paperclip, Plus, StickyNote, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { deleteFile, fileBlob, filesOptions, notesOptions, saveBlob, type FileScope } from '../api/queries'
import type { FileRef, Note } from '../api/types'
import { canPreview, formatSize, openPreview } from '../files/preview'
import { hasFiles, uploadAll, type Upload } from '../files/upload'
import { NoteEditor } from './NotesPanel'
import './notes.css'

// The first line with words in it; a note holding only attached files is "Note with files".
const title = (n: Note) => {
  const lines = n.body.replace(/\[file:[0-9a-f-]{36}\]/g, '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim())
  return lines.find(Boolean)?.slice(0, 40) ?? (/\[file:/.test(n.body) ? 'Note with files' : 'Empty note')
}

/**
 * Notes & attachments on an email or project (FR-CNT-003/006): a free place to jot things down, and 📎. Every note and
 * file is a pill in one box; click a note pill to open it, drop files anywhere on the box.
 */
export function NotesAttach({ target, wide = false, taskTools }: { target: FileScope & { type: 'email' | 'project' }; wide?: boolean; taskTools?: (text: string) => ReactNode }) {
  const notes = useQuery(notesOptions(target))
  const files = useQuery(filesOptions(target))
  const [open, setOpen] = useState<string | 'new' | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const add = (list: FileList | null) => {
    if (list?.length) void uploadAll(target, [...list], setUploads)
  }
  const current = open && open !== 'new' ? notes.data?.find((n) => n.id === open) : undefined

  return (
    <div
      className="na"
      data-wide={wide || undefined}
      data-over={over || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        add(e.dataTransfer.files)
      }}
    >
      <div className="na-bar">
        <button type="button" className="ghost-button" onClick={() => setOpen('new')} disabled={open === 'new'}>
          <Plus size={14} aria-hidden="true" /> Add note
        </button>
        <button type="button" className="ghost-button" onClick={() => input.current?.click()}>
          <Paperclip size={14} aria-hidden="true" /> Attach files
        </button>
        <span className="drawer-muted">or drop files here · up to 25 MB each</span>
        <input ref={input} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      </div>
      {(notes.isError || files.isError) && (
        <p className="drawer-muted" role="alert">
          Couldn't load everything.
        </p>
      )}
      {(notes.data?.length || files.data?.length || uploads.length) ? (
        <ul className="na-pills" aria-label="Notes and attachments">
          {notes.data?.map((n) => (
            <li key={n.id}>
              <button type="button" className="na-pill" aria-expanded={open === n.id} data-on={open === n.id || undefined} onClick={() => setOpen(open === n.id ? null : n.id)}>
                <StickyNote size={13} aria-hidden="true" />
                <span>{title(n)}</span>
              </button>
            </li>
          ))}
          {files.data?.map((f) => <FilePill key={f.id} file={f} scope={target} />)}
          {uploads.map((u) => (
            <li key={u.key} className="na-pill" data-error={u.error ? true : undefined}>
              <Paperclip size={13} aria-hidden="true" />
              <span>{u.name}</span>
              <span className="drawer-muted" role={u.error ? 'alert' : undefined}>{u.error ?? 'Uploading…'}</span>
              {u.error && (
                <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {open === 'new' && <NoteEditor key="new" scope={target} note={null} initial="" autoFocus onSettled={() => setOpen(null)} taskTools={taskTools} />}
      {current && <NoteEditor key={current.id} scope={target} note={current} initial={current.body} autoFocus onSettled={() => setOpen(null)} taskTools={taskTools} />}
    </div>
  )
}

function FilePill({ file, scope }: { file: FileRef; scope: FileScope }) {
  const [error, setError] = useState<string | null>(null)
  const path = `/files/${file.id}`
  const Icon = file.mime.startsWith('image/') ? ImageIcon : FileText
  const view = () => (canPreview(file.mime) ? openPreview(path, file.filename, file.mime) : void fileBlob(path).then((b) => saveBlob(b, file.filename), () => setError("Couldn't download")))
  return (
    <li className="na-pill" data-file title={`${file.filename} · ${formatSize(file.size)}`}>
      <button type="button" className="na-pill-main" onClick={view} aria-label={`${canPreview(file.mime) ? 'Preview' : 'Download'} ${file.filename}`}>
        <Icon size={13} aria-hidden="true" />
        <span>{file.filename}</span>
      </button>
      {canPreview(file.mime) && (
        <button type="button" className="icon-button" aria-label={`Download ${file.filename}`} onClick={() => void fileBlob(path).then((b) => saveBlob(b, file.filename), () => setError("Couldn't download"))}>
          <Download size={12} aria-hidden="true" />
        </button>
      )}
      <button type="button" className="icon-button" aria-label={`Remove ${file.filename}`} onClick={() => void deleteFile(scope, file).catch(() => setError("Couldn't delete"))}>
        <X size={12} aria-hidden="true" />
      </button>
      {error && <span className="pd-error" role="alert">{error}</span>}
    </li>
  )
}
