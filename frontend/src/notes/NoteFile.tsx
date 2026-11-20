import { useQuery } from '@tanstack/react-query'
import { FileText, Image as ImageIcon } from 'lucide-react'
import { useContext, useState } from 'react'
import { fileBlob, filesOptions, saveBlob, type FileScope } from '../api/queries'
import { canPreview, formatSize, openPreview } from '../files/preview'

import { NoteFilesContext } from './noteFilesContext'

/** A file attached inside a note (task 13 polish): a chip that previews or downloads; "File removed" once deleted. */
export function NoteFile({ id }: { id: string }) {
  const scope = useContext(NoteFilesContext)
  if (!scope) return <span className="drawer-muted">[file]</span>
  return <Chip id={id} scope={scope} />
}

function Chip({ id, scope }: { id: string; scope: FileScope }) {
  const files = useQuery(filesOptions(scope))
  const [error, setError] = useState(false)
  const file = files.data?.find((f) => f.id === id)
  if (files.isPending) return <span className="note-file drawer-muted">Loading file…</span>
  if (!file) return <span className="note-file drawer-muted">File removed</span>
  const path = `/files/${file.id}`
  const Icon = file.mime.startsWith('image/') ? ImageIcon : FileText
  return (
    <button
      type="button"
      className="note-file"
      title={`${file.filename} · ${formatSize(file.size)}`}
      data-error={error || undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (canPreview(file.mime)) openPreview(path, file.filename, file.mime)
        else void fileBlob(path).then((b) => saveBlob(b, file.filename), () => setError(true))
      }}
    >
      <Icon size={13} aria-hidden="true" />
      <span>{error ? "Couldn't download" : file.filename}</span>
    </button>
  )
}
