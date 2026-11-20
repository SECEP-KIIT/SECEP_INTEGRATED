import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileText, Image as ImageIcon, Paperclip, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { deleteFile, fileBlob, filesOptions, saveBlob, type FileScope } from '../api/queries'
import type { FileRef } from '../api/types'
import { canPreview, formatSize, openPreview } from './preview'
import { hasFiles, uploadAll, type Upload } from './upload'
import './files.css'

/**
 * Files on a card or project (FR-CNT-006): 📎, or drop files from the desktop on the panel. 25 MB a file within the
 * user's quota. Images and PDFs preview; everything else downloads (FR-CNT-008).
 */
export function FilesPanel({ scope }: { scope: FileScope }) {
  const files = useQuery(filesOptions(scope))
  const [uploads, setUploads] = useState<Upload[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()

  const add = (list: FileList | null) => {
    if (list?.length) void uploadAll(scope, [...list], setUploads)
  }

  return (
    <div
      className="files"
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
      {files.isError && (
        <p className="drawer-muted" role="alert">
          Couldn't load files.
        </p>
      )}
      <ul className="files-list" aria-label="Files">
        {files.data?.map((f) => <FileRow key={f.id} file={f} scope={scope} />)}
        {uploads.map((u) => (
          <li key={u.key} className="file-row" data-error={u.error ? true : undefined}>
            <Paperclip size={14} aria-hidden="true" />
            <span className="file-name">{u.name}</span>
            <span className="drawer-muted" role={u.error ? 'alert' : undefined}>
              {u.error ?? 'Uploading…'}
            </span>
            {u.error && (
              <button type="button" className="text-button" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="files-foot">
        <button type="button" className="ghost-button" onClick={() => input.current?.click()} aria-describedby={`${id}-hint`}>
          <Paperclip size={14} aria-hidden="true" />
          Attach files
        </button>
        <span className="drawer-muted" id={`${id}-hint`}>
          or drop them here · up to 25 MB each
        </span>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

function FileRow({ file, scope }: { file: FileRef; scope: FileScope }) {
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const path = `/files/${file.id}`
  const Icon = file.mime.startsWith('image/') ? ImageIcon : FileText
  return (
    <li className="file-row">
      <Icon size={14} aria-hidden="true" />
      <span className="file-name" title={file.filename}>
        {file.filename}
      </span>
      <span className="drawer-muted">{formatSize(file.size)}</span>
      <span className="file-tools">
        {canPreview(file.mime) && (
          <button type="button" className="icon-button" aria-label={`Preview ${file.filename}`} onClick={() => openPreview(path, file.filename, file.mime)}>
            <Eye size={14} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={`Download ${file.filename}`}
          onClick={() => void fileBlob(path).then((b) => saveBlob(b, file.filename), () => setError("Couldn't download"))}
        >
          <Download size={14} aria-hidden="true" />
        </button>
        {confirm ? (
          <button type="button" className="text-button file-delete" onClick={() => void deleteFile(scope, file).catch(() => setError("Couldn't delete"))} onBlur={() => setConfirm(false)} autoFocus>
            Delete?
          </button>
        ) : (
          <button type="button" className="icon-button" aria-label={`Delete ${file.filename}`} onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </span>
      {error && (
        <span className="pd-error" role="alert">
          {error}
        </span>
      )}
    </li>
  )
}
