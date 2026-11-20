// Previews (FR-CNT-008): images and PDFs, fetched with the bearer token and shown from a blob URL in the preview
// dialog (FilePreview). Everything else downloads.
export const PREVIEW_EVENT = 'secep:file-preview'
const EVENT = PREVIEW_EVENT

export interface PreviewRequest {
  path: string
  filename: string
  mime: string
}

export const canPreview = (mime: string) => /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(mime)

/** The latest request, for the dialog's chunk when it loads after the first one was sent. */
let pending: PreviewRequest | null = null

export function openPreview(path: string, filename: string, mime: string) {
  pending = { path, filename, mime }
  dispatchEvent(new CustomEvent<PreviewRequest>(EVENT, { detail: pending }))
}

export function onPreview(fn: (r: PreviewRequest) => void) {
  if (pending) fn(pending)
  pending = null
  const handler = (e: Event) => fn((e as CustomEvent<PreviewRequest>).detail)
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
