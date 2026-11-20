import { Download, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fileBlob, saveBlob } from '../api/queries'
import { onPreview, type PreviewRequest } from './preview'
import './files.css'

/**
 * The preview dialog (FR-CNT-008). The file is fetched with the bearer token and shown from a blob URL: images in an
 * <img> (no script can run), PDFs in the browser's own PDF viewer inside an iframe, which renders in the browser's
 * sandboxed PDF process, never as a page of ours. The server still serves both with a sandbox CSP and nosniff.
 * Mounted once in the shell.
 */
export function FilePreviewHost() {
  const ref = useRef<HTMLDialogElement>(null)
  const [req, setReq] = useState<PreviewRequest | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(
    () =>
      onPreview((r) => {
        setReq(r)
        setUrl(null)
        setError(false)
      }),
    [],
  )
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (req && !d.open) d.showModal()
    if (!req && d.open) d.close()
    if (!req) return
    let live = true
    let made: string | null = null
    fileBlob(req.path, true).then(
      (b) => {
        if (!live) return
        // The type comes from what we expect, not from the response: a PDF is shown as a PDF, an image as an image.
        made = URL.createObjectURL(new Blob([b], { type: req.mime }))
        setUrl(made)
      },
      () => live && setError(true),
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [req])

  const close = () => setReq(null)
  return (
    <dialog ref={ref} className="file-preview" aria-label={req ? `Preview of ${req.filename}` : 'Preview'} onClose={close} onClick={(e) => e.target === ref.current && close()}>
      {req && (
        <>
          <header className="fp-head">
            <span className="file-name">{req.filename}</span>
            <button type="button" className="icon-button" aria-label="Download" onClick={() => void fileBlob(req.path).then((b) => saveBlob(b, req.filename))}>
              <Download size={16} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="Close" onClick={close}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="fp-body">
            {error ? (
              <p className="col-state" role="alert">
                Couldn't load the preview.
              </p>
            ) : !url ? (
              <p className="col-state">Loading…</p>
            ) : req.mime === 'application/pdf' ? (
              <iframe title={req.filename} src={url} />
            ) : (
              <img src={url} alt={req.filename} />
            )}
          </div>
        </>
      )}
    </dialog>
  )
}
