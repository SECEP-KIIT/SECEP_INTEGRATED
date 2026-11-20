// Projects (FR-UI-016–017, §6.5 v1.1). Wire shapes PROPOSED in proposals §4 and §18: a user-owned container of
// emails and cards; archive replaces delete. An email or card may be in several projects; the first is primary.
import type { ProjectItem } from '../../api/types'
import { page } from '../http/cursor'
import { Fail, own, route } from '../http/route'
import { isDateTime, isOptStr, isStr, object, type Fields } from '../http/validate'
import { changed, db } from '../store/db'
import { ensureEmailCard } from '../store/emailCards'
import { publish } from '../store/events'
import { toAction, toListItem, toProject } from '../store/serialize'
import type { ProjectItemRow, ProjectRow, UserRow } from '../store/types'

const HEX = /^#[0-9a-fA-F]{6}$/
const JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}$/
const JIRA_ISSUE = /^[A-Z][A-Z0-9]{1,9}-\d+$/
const FIELDS = ['name', 'colour', 'icon', 'description', 'deadline', 'jira_project_key', 'jira_epic'] as const
/** A user's projects, archived included (they stay searchable, FR-UI-016). */
const MAX_PROJECTS = 100

function checkFields(f: Fields, partial: boolean) {
  const b = f.body
  if (!partial || 'name' in b) if (!isStr(b.name, 60) || !(b.name as string).trim()) f.add('name', 'Required, at most 60 characters')
  if (!partial || 'colour' in b) if (typeof b.colour !== 'string' || !HEX.test(b.colour)) f.add('colour', 'Must be #rrggbb')
  if ('icon' in b && !(b.icon === null || (isStr(b.icon, 16) && [...(b.icon as string)].length <= 4))) f.add('icon', 'One emoji, or null')
  if ('description' in b && !isOptStr(b.description, 500)) f.add('description', 'At most 500 characters')
  if ('deadline' in b && b.deadline !== null && !isDateTime(b.deadline)) f.add('deadline', 'Must be an ISO date-time, or null')
  if ('jira_project_key' in b && b.jira_project_key !== null && !(typeof b.jira_project_key === 'string' && JIRA_KEY.test(b.jira_project_key))) {
    f.add('jira_project_key', 'A Jira project key, like ATL')
  }
  if ('jira_epic' in b && b.jira_epic !== null && !(typeof b.jira_epic === 'string' && JIRA_ISSUE.test(b.jira_epic))) f.add('jira_epic', 'A Jira issue key, like ATL-100')
}

const toItem = ({ project_id, email_id, action_id, is_primary, added_at }: ProjectItemRow): ProjectItem => ({ project_id, email_id, action_id, is_primary, added_at })

/** Tells every open tab that an email's or card's projects changed (cards patch in place). */
function emitItem(user: UserRow, item: Pick<ProjectItemRow, 'email_id' | 'action_id'>) {
  const email = item.email_id ? db.emails.get(item.email_id) : undefined
  if (email) publish(user.id, 'email.triaged', { email_id: email.id, email: toListItem(db, email) })
  const card = item.action_id ? db.actions.get(item.action_id) : undefined
  if (card) publish(user.id, 'action.updated', { action: toAction(card) })
}

/** The item's other projects: when the primary leaves, the oldest remaining one becomes primary (FR-UI-017). */
function promoteNext(key: Pick<ProjectItemRow, 'email_id' | 'action_id'>) {
  const rest = db.projectItems
    .filter((i) => i.email_id === key.email_id && i.action_id === key.action_id)
    .sort((a, b) => a.added_at.localeCompare(b.added_at))
  if (rest.length && !rest.some((i) => i.is_primary)) rest[0].is_primary = true
}

const owned = (user: UserRow, id: string) => own(db.projects.find((p) => p.id === id), user, 'Project')

export const projectRoutes = [
  // Active projects first, then archived; each oldest first (the sidebar order).
  route('get', '/projects', 'user', ({ user, url }) =>
    page(
      url,
      db.projects
        .filter((p) => p.user_id === user.id)
        .sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.created_at.localeCompare(b.created_at))
        .map((p) => toProject(db, p)),
    ),
  ),

  route('post', '/projects', 'user', ({ user, body }) => {
    const f = object(body).only(FIELDS)
    checkFields(f, false)
    f.done()
    if (db.projects.filter((p) => p.user_id === user.id).length >= MAX_PROJECTS) throw new Fail(409, 'conflict', `At most ${MAX_PROJECTS} projects`)
    const b = f.body
    const p: ProjectRow = {
      id: crypto.randomUUID(), user_id: user.id, name: (b.name as string).trim(), colour: (b.colour as string).toLowerCase(),
      icon: (b.icon as string | null) ?? null, description: (b.description as string | null) ?? null, deadline: (b.deadline as string | null) ?? null,
      jira_project_key: (b.jira_project_key as string | null) ?? null, jira_epic: (b.jira_epic as string | null) ?? null,
      archived_at: null, created_at: new Date().toISOString(),
    }
    db.projects.push(p)
    changed()
    return toProject(db, p)
  }, { status: 201 }),

  route<{ id: string }>('get', '/projects/:id', 'user', ({ user, params }) => toProject(db, owned(user, params.id))),

  route<{ id: string }>('patch', '/projects/:id', 'user', ({ user, params, body }) => {
    const p = owned(user, params.id)
    const f = object(body).only([...FIELDS, 'archived'])
    checkFields(f, true)
    if ('archived' in f.body && typeof f.body.archived !== 'boolean') f.add('archived', 'Must be true or false')
    f.done()
    const { archived, ...rest } = f.body
    Object.assign(p, rest)
    if (typeof rest.name === 'string') p.name = rest.name.trim()
    if (typeof rest.colour === 'string') p.colour = rest.colour.toLowerCase()
    if (archived === true && !p.archived_at) p.archived_at = new Date().toISOString()
    if (archived === false) p.archived_at = null
    changed()
    return toProject(db, p)
  }),

  route<{ id: string }>('post', '/projects/:id/items', 'user', ({ user, params, body }) => {
    const p = owned(user, params.id)
    const f = object(body).only(['email_id', 'action_id', 'primary'])
    const { email_id, action_id, primary } = f.body
    if ((email_id === undefined) === (action_id === undefined)) f.add('email_id', 'Exactly one of email_id and action_id')
    if (primary !== undefined && typeof primary !== 'boolean') f.add('primary', 'Must be true or false')
    f.done()
    if (p.archived_at) throw new Fail(409, 'conflict', 'This project is archived')
    const key = {
      email_id: typeof email_id === 'string' ? own(db.emails.get(email_id), user, 'Email').id : null,
      action_id: typeof action_id === 'string' ? own(db.actions.get(action_id), user, 'Card').id : null,
    }
    const siblings = db.projectItems.filter((i) => i.email_id === key.email_id && i.action_id === key.action_id)
    let item = siblings.find((i) => i.project_id === p.id)
    if (!item) {
      item = { project_id: p.id, ...key, is_primary: siblings.length === 0, added_at: new Date().toISOString() }
      db.projectItems.push(item)
    }
    if (primary === true) for (const s of [...siblings, item]) s.is_primary = s === item
    // An email in a project is a task on its board (proposals §23).
    if (key.email_id) ensureEmailCard(user.id, db.emails.get(key.email_id)!)
    changed()
    emitItem(user, item)
    return toItem(item)
  }),

  route<{ id: string; itemId: string }>('delete', '/projects/:id/items/:itemId', 'user', ({ user, params }) => {
    const p = owned(user, params.id)
    const item = db.projectItems.find((i) => i.project_id === p.id && (i.email_id === params.itemId || i.action_id === params.itemId))
    if (!item) throw new Fail(404, 'not_found', 'Item not in this project')
    db.projectItems = db.projectItems.filter((i) => i !== item)
    promoteNext(item)
    changed()
    emitItem(user, item)
    return undefined
  }),
]
