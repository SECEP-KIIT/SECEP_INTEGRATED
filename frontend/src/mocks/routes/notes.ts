// Notes (FR-CNT-003, proposals §19.2): on an email, card or project, or standalone. Stored as typed (no masking).
import type { Note } from '../../api/types'
import { page } from '../http/cursor'
import { Fail, own, route } from '../http/route'
import { isStr, object } from '../http/validate'
import { changed, db } from '../store/db'
import { publish } from '../store/events'
import { toListItem } from '../store/serialize'
import type { NoteRow, UserRow } from '../store/types'

const TARGETS = ['email', 'card', 'project'] as const
type Target = (typeof TARGETS)[number]
const MAX = 20_000

/** An email's 📝 count changed: its card updates in place, in every tab. */
function emitEmail(n: NoteRow) {
  const e = n.target_type === 'email' ? db.emails.get(n.target_id!) : undefined
  if (e) publish(e.user_id, 'email.triaged', { email_id: e.id, email: toListItem(db, e) })
}

const toNote = ({ owner_user_id: _o, ...n }: NoteRow): Note => ({ ...n })

/** The target must be the user's own (404 otherwise, as for any other row). */
function checkTarget(user: UserRow, type: Target, id: string) {
  if (type === 'email') own(db.emails.get(id), user, 'Email')
  else if (type === 'card') {
    const a = own(db.actions.get(id), user, 'Card')
    if (a.email_id !== null) throw new Fail(404, 'not_found', 'Card not found')
  } else own(db.projects.find((p) => p.id === id), user, 'Project')
}

export const noteRoutes = [
  route('get', '/notes', 'user', ({ user, url }) => {
    const type = url.searchParams.get('target_type')
    const id = url.searchParams.get('target_id')
    if (type && type !== 'none' && !(TARGETS as readonly string[]).includes(type)) throw new Fail(400, 'bad_request', 'Unknown target_type')
    if (type && type !== 'none' && !id) throw new Fail(400, 'bad_request', 'target_id is required with target_type')
    if (type && type !== 'none') checkTarget(user, type as Target, id!)
    const items = db.notes
      .filter((n) => n.owner_user_id === user.id && (!type || (type === 'none' ? n.target_type === null : n.target_type === type && n.target_id === id)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return page(url, items.map(toNote))
  }),

  route('post', '/notes', 'user', ({ user, body }) => {
    const f = object(body).only(['target_type', 'target_id', 'body'])
    const { target_type: type = null, target_id: id = null } = f.body as { target_type?: string | null; target_id?: string | null }
    if (type !== null && !(TARGETS as readonly string[]).includes(type)) f.add('target_type', 'Must be email, card, project or null')
    if ((type === null) !== (id === null)) f.add('target_id', 'Give both target_type and target_id, or neither')
    if (!isStr(f.body.body, MAX)) f.add('body', `Text, at most ${MAX} characters`)
    f.done()
    if (type) checkTarget(user, type as Target, id!)
    const at = new Date().toISOString()
    const n: NoteRow = {
      id: crypto.randomUUID(), owner_user_id: user.id, target_type: type as Target | null, target_id: id,
      body: f.body.body as string, created_at: at, updated_at: at,
    }
    db.notes.push(n)
    changed()
    emitEmail(n)
    return toNote(n)
  }, { status: 201 }),

  route<{ id: string }>('patch', '/notes/:id', 'user', ({ user, params, body }) => {
    const n = own(db.notes.find((x) => x.id === params.id), user, 'Note')
    const f = object(body).only(['body'])
    if (!isStr(f.body.body, MAX)) f.add('body', `Text, at most ${MAX} characters`)
    f.done()
    n.body = f.body.body as string
    n.updated_at = new Date().toISOString()
    changed()
    return toNote(n)
  }),

  route<{ id: string }>('delete', '/notes/:id', 'user', ({ user, params }) => {
    const n = own(db.notes.find((x) => x.id === params.id), user, 'Note')
    db.notes = db.notes.filter((x) => x !== n)
    changed()
    emitEmail(n)
    return undefined
  }),
]
