import { Download, Eye } from 'lucide-react'
import { useState } from 'react'
import { fileBlob, saveBlob } from '../api/queries'
import type { EmailDetail } from '../api/types'
import { canPreview, openPreview } from './preview'
import './files.css'

/** Preview and download for an email attachment (FR-CNT-007): fetched from Gmail on demand, never stored. */
export function AttachmentTools({ emailId, attachment: a }: { emailId: string; attachment: EmailDetail['attachments'][number] }) {
  const [error, setError] = useState(false)
  const path = `/emails/${emailId}/attachments/${a.index}`
  return (
    <span className="file-tools">
      {canPreview(a.mime) && (
        <button type="button" className="icon-button" aria-label={`Preview ${a.filename}`} onClick={() => openPreview(path, a.filename, a.mime)}>
          <Eye size={14} aria-hidden="true" />
        </button>
      )}
      <button type="button" className="icon-button" aria-label={`Download ${a.filename}`} onClick={() => void fileBlob(path).then((b) => saveBlob(b, a.filename), () => setError(true))}>
        <Download size={14} aria-hidden="true" />
      </button>
      {error && (
        <span className="pd-error" role="alert">
          Couldn't fetch it from Gmail
        </span>
      )}
    </span>
  )
}
