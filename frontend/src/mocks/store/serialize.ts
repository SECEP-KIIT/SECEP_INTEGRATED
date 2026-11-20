// The ONLY place wire shapes are built (SRS §6.4.1). Rows → responses. Fields not listed in §6.4.1 never leave
// here: raw URLs, secret values, user_id, ml_text and other internals. The contract tests pin the key sets.
import type { Action, EmailDetail, EmailListItem, EmailProjectRef, LinkView, Me, Project, RoleCategory, SenderPerson } from '../../api/types'
import { dueDateOfActions } from '../../lib/due'
import { SENDERS } from './templates'
import type { ActionRow, Db, EmailRow, ModelRow, ProjectRow, SettingsRow, UrlCheckRow, UserRow } from './types'

// The store, for toAction's project list. Bound by db.ts (a direct import would be a cycle through generate.ts).
let store: (() => Db) | null = null
export const bindStore = (get: () => Db) => void (store = get)

export function toAction(a: ActionRow): Action {
  // undo_until is server state (§6.6), not part of the §6.4.1 Action shape.
  const { user_id: _owner, undo_until: _undo, ...action } = a
  // PROPOSED (proposals §19.1): a user card's projects; [] for an email's actions (the email carries them).
  const projects = a.origin === 'user' && a.email_id === null && a.type === 'add_board_card' && store ? itemProjectRefs(store(), 'action_id', a.id) : []
  return { ...action, card_id: a.card_id ?? null, payload: { ...action.payload }, projects }
}

export function toLink(c: UrlCheckRow): LinkView {
  const scored = c.verdict !== 'pending'
  return {
    check_id: scored ? c.id : null,
    anchor_text: c.anchor_text,
    host: c.host,
    verdict: c.verdict,
    go_url: scored ? `/api/v1/links/${c.id}/go` : null,
  }
}

// PROPOSED (pending SRS v1.3, proposals §8.5): the sender's role, as M6 would look it up in the tenant directory.
// Only EmailListItem.from carries it; to, cc and thread messages stay plain Person (§6.4.1).
const ROLES = new Map<string, RoleCategory>(SENDERS.flatMap((s) => (s.role ? [[s.address, s.role] as const] : [])))
const sender = (p: { address: string; name: string | null }): SenderPerson => ({ ...p, role_category: ROLES.get(p.address.toLowerCase()) ?? null })

export { localDate } from '../../lib/due'
/** PROPOSED due_date (proposals §10.2); one rule for the mock and the client (src/lib/due.ts). */
export const dueDateOf = (actions: ActionRow[]) => dueDateOfActions(actions)

export function toListItem(db: Db, e: EmailRow): EmailListItem {
  const thread = e.thread_id ? db.threads.get(e.thread_id) : undefined
  const actions = [...db.actions.values()].filter((a) => a.email_id === e.id)
  const jira = actions.find((a) => a.type === 'create_jira_issue' && a.external_ref)
  return {
    id: e.id,
    thread_id: e.thread_id,
    from: sender(e.from),
    to: e.to.map((p) => ({ ...p })),
    cc: e.cc.map((p) => ({ ...p })),
    recipient_position: e.recipient_position,
    subject: e.subject,
    received_at: e.received_at,
    status: e.status,
    security_flag: e.security_flag,
    duplicate_count: e.duplicate_count,
    attachment_count: e.attachments.length,
    reply_count: thread ? thread.messages.length - 1 : 0,
    has_masked_secret: db.secrets.some((s) => s.email_id === e.id),
    triage: e.triage && structuredClone(e.triage),
    summary_one_line: e.summary?.one_line ?? null,
    proposed_action_count: actions.filter((a) => a.status === 'proposed').length,
    jira_key: jira?.external_ref ?? null,
    pinned: e.pinned,
    snoozed_until: e.snoozed_until,
    due_date: dueDateOf(actions),
    handled: db.handled.get(e.user_id)?.has(e.id) ?? false,
    read: db.reads.get(e.user_id)?.has(e.id) ?? false, // PROPOSED (proposals §12.3)
    projects: emailProjectRefs(db, e.id),
    note_count: db.notes.filter((n) => n.target_type === 'email' && n.target_id === e.id && n.owner_user_id === e.user_id).length,
    tags: [],
  }
}

/**
 * PROPOSED open_url (proposals §18.4): the message in Gmail on the web, for the mailbox's own account. M6 builds it
 * from provider_message_id; the mock has none, so it makes a stable fake one from the email id.
 */
function gmailUrl(db: Db, e: EmailRow): string {
  const user = db.users.find((u) => u.id === e.user_id)
  const account = encodeURIComponent(user?.mailbox?.address ?? user?.email ?? '')
  return `https://mail.google.com/mail/?authuser=${account}#all/${e.id.replace(/-/g, '').slice(-16)}`
}

export function toDetail(db: Db, e: EmailRow): EmailDetail {
  const thread = e.thread_id ? db.threads.get(e.thread_id) : undefined
  return {
    ...toListItem(db, e),
    body_text: e.body_text,
    summary_short: e.summary?.short ?? null,
    actions: [...db.actions.values()].filter((a) => a.email_id === e.id).map(toAction),
    links: db.urlChecks.filter((c) => c.email_id === e.id).map(toLink),
    attachments: e.attachments.map((a) => ({ ...a })),
    // Same order as the [MASKED:<type>] tokens in body_text.
    masked_secrets: db.secrets.filter((s) => s.email_id === e.id).map((s) => ({ id: s.id, secret_type: s.secret_type })),
    open_url: gmailUrl(db, e),
    auth_results: e.auth_results && { ...e.auth_results },
    thread: thread
      ? { id: thread.id, message_count: thread.messages.length, messages: thread.messages.map((m) => ({ ...m, from: { ...m.from } })) }
      : null,
  }
}

export function toMe(u: UserRow): Me {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role_category: u.role_category,
    is_admin: u.is_admin,
    permissions: [...u.permissions],
    mailbox: u.mailbox && { ...u.mailbox },
    ui_prefs: { ...u.ui_prefs },
  }
}

/** Admin `User` (§6.4.1). */
export function toUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name,
    role_category: u.role_category,
    is_admin: u.is_admin,
    permissions: [...u.permissions],
    last_login_at: u.last_login_at,
  }
}

/** GET /admin/settings: secret values are never returned, only whether they are set (§6.4.1). */
export function toSettings(s: SettingsRow) {
  return {
    jira: { site_url: s.jira.site_url, email: s.jira.email, project_key: s.jira.project_key, token_set: s.jira.token !== null },
    llm: { base_url: s.llm.base_url, model: s.llm.model, api_style: s.llm.api_style, api_key_set: s.llm.api_key !== null },
    confidence_threshold: s.confidence_threshold,
    protected_domains: [...s.protected_domains],
    poll_interval_s: s.poll_interval_s,
  }
}

export function toModel(m: ModelRow) {
  return { id: m.id, version: m.version, status: m.status, metrics: structuredClone(m.metrics), created_at: m.created_at, promoted_at: m.promoted_at }
}

/** An email's projects for its card (proposals §4, §18): primary first, then in the order added. */
export const emailProjectRefs = (db: Db, emailId: string) => itemProjectRefs(db, 'email_id', emailId)

function itemProjectRefs(db: Db, key: 'email_id' | 'action_id', id: string): EmailProjectRef[] {
  return db.projectItems
    .filter((i) => i[key] === id)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.added_at.localeCompare(b.added_at))
    .flatMap((i) => {
      const p = db.projects.find((x) => x.id === i.project_id)
      return p ? [{ id: p.id, name: p.name, colour: p.colour, is_primary: i.is_primary }] : []
    })
}

/** Board cards that belong to a project: from its emails, or cards filed in it (§6.5 /me projects progress). */
export function projectCards(db: Db, projectId: string): ActionRow[] {
  const items = db.projectItems.filter((i) => i.project_id === projectId)
  const emails = new Set(items.map((i) => i.email_id).filter(Boolean))
  const cards = new Set(items.map((i) => i.action_id).filter(Boolean))
  return [...db.actions.values()].filter((a) => a.board_column !== null && a.status === 'done' && ((a.email_id && emails.has(a.email_id)) || cards.has(a.id)))
}

export function toProject(db: Db, p: ProjectRow): Project {
  const { user_id: _owner, ...project } = p
  const cards = projectCards(db, p.id)
  return { ...project, progress: { done: cards.filter((a) => a.board_column === 'done').length, total: cards.length } }
}
