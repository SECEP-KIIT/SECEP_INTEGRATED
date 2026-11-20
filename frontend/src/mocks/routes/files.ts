// Files (FR-CNT-006/007/008, proposals §19.3): uploads on cards and projects within 25 MB a file and the user's
// quota; downloads always as attachments with nosniff and a sandbox CSP; ?inline=1 only for images and PDFs. Email
// attachments are streamed "from Gmail" (here: a small generated file) and never stored.
import { HttpResponse } from 'msw'
import type { FileRef } from '../../api/types'
import { page } from '../http/cursor'
import { Fail, own, route } from '../http/route'
import { changed, db } from '../store/db'
import type { FileRow, UserRow } from '../store/types'

const MAX_BYTES = 25 * 1024 * 1024
/** FR-ADM-008's per-user quota; the mock has no admin field for it, so the documented default. */
const QUOTA_BYTES = 500 * 1024 * 1024
const TARGETS = ['email', 'card', 'project'] as const

/** The bytes, in memory only: localStorage can't hold them. */
const blobs = new Map<string, Blob>()

const toRef = ({ owner_user_id: _o, ...f }: FileRow): FileRef => ({ ...f })
const PREVIEW = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/

/** Only the last path part, no control characters, at most 200 characters (proposals §19.3). */
export const safeName = (name: string) =>
  // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
  (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200) || 'file'

function checkTarget(user: UserRow, type: string, id: string) {
  if (type === 'email') own(db.emails.get(id), user, 'Email')
  else if (type === 'card') {
    const a = own(db.actions.get(id), user, 'Card')
    if (a.email_id !== null) throw new Fail(404, 'not_found', 'Card not found')
  } else own(db.projects.find((p) => p.id === id), user, 'Project')
}

/** FR-CNT-008 headers on every download. */
export function fileResponse(body: Blob, filename: string, mime: string, inline: boolean) {
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  return new HttpResponse(body, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox; default-src \'none\'',
      'Cache-Control': 'private, no-store',
    },
  })
}

// A tiny valid PDF and PNG, for "streamed from Gmail" previews in the mock.
const PDF = (title: string) =>
  `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 14 Tf 30 120 Td (${title.replace(/[()\\]/g, '')}) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKElEQVR42mNkYPhfz0AEYBxVSF+FjAwM/xmIBIyjCumrkJEBpIZBBQAX5gkRB1ZDZgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

export const fileRoutes = [
  route('get', '/files', 'user', ({ user, url }) => {
    const type = url.searchParams.get('target_type') ?? ''
    const id = url.searchParams.get('target_id') ?? ''
    if (!(TARGETS as readonly string[]).includes(type) || !id) throw new Fail(400, 'bad_request', 'target_type (email, card or project) and target_id are required')
    checkTarget(user, type, id)
    const items = db.files.filter((f) => f.owner_user_id === user.id && f.target_type === type && f.target_id === id && blobs.has(f.id))
    return page(url, items.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(toRef))
  }),

  route('post', '/files', 'user', async ({ user, request }) => {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new Fail(400, 'bad_request', 'Expected multipart/form-data')
    }
    const type = String(form.get('target_type') ?? '')
    const id = String(form.get('target_id') ?? '')
    const file = form.get('file')
    const fields: Record<string, string> = {}
    if (!(TARGETS as readonly string[]).includes(type)) fields.target_type = 'Must be email, card or project'
    if (!id) fields.target_id = 'Required'
    if (!(file instanceof File)) fields.file = 'Required'
    if (Object.keys(fields).length) throw new Fail(422, 'validation_failed', 'Some fields are invalid', { fields })
    checkTarget(user, type, id)
    const f = file as File
    if (f.size > MAX_BYTES) throw new Fail(413, 'file_too_large', 'Files can be at most 25 MB')
    const used = db.files.filter((x) => x.owner_user_id === user.id).reduce((n, x) => n + x.size, 0)
    if (used + f.size > QUOTA_BYTES) throw new Fail(413, 'quota_exceeded', 'Your file space is full. Delete some files first.')
    const row: FileRow = {
      id: crypto.randomUUID(), owner_user_id: user.id, target_type: type as FileRow['target_type'], target_id: id,
      filename: safeName(f.name), mime: f.type || 'application/octet-stream', size: f.size, created_at: new Date().toISOString(),
    }
    blobs.set(row.id, f)
    db.files.push(row)
    changed()
    return toRef(row)
  }, { status: 201, raw: true }),

  route<{ id: string }>('get', '/files/:id', 'user', ({ user, params, url }) => {
    const f = own(db.files.find((x) => x.id === params.id), user, 'File')
    const blob = blobs.get(f.id)
    if (!blob) throw new Fail(404, 'not_found', 'File not found')
    return fileResponse(blob, f.filename, f.mime, url.searchParams.get('inline') === '1' && PREVIEW.test(f.mime))
  }),

  route<{ id: string }>('delete', '/files/:id', 'user', ({ user, params }) => {
    const f = own(db.files.find((x) => x.id === params.id), user, 'File')
    db.files = db.files.filter((x) => x !== f)
    blobs.delete(f.id)
    changed()
    return undefined
  }),

  // FR-CNT-007: an email attachment, fetched on demand and never stored.
  route<{ id: string; index: string }>('get', '/emails/:id/attachments/:index', 'user', ({ user, params, url }) => {
    const e = own(db.emails.get(params.id), user, 'Email')
    const a = /^\d+$/.test(params.index) ? e.attachments[Number(params.index)] : undefined
    if (!a) throw new Fail(404, 'not_found', 'Attachment not found')
    const body = a.mime === 'application/pdf' ? new Blob([PDF(a.filename)], { type: a.mime }) : a.mime.startsWith('image/') ? new Blob([PNG], { type: 'image/png' }) : new Blob([`Mock attachment: ${a.filename}\n`], { type: 'text/plain' })
    const mime = a.mime.startsWith('image/') ? 'image/png' : a.mime === 'application/pdf' ? a.mime : 'text/plain'
    return fileResponse(body, a.filename, mime, url.searchParams.get('inline') === '1' && PREVIEW.test(mime))
  }),
]
