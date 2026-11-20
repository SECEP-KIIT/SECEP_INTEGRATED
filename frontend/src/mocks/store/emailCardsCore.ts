// The seeding half of proposals §23 (no live-store import, so generate.ts can use it without a cycle).
import type { BoardColumn } from '../../api/types'
import type { ActionRow, Db, EmailRow } from './types'

/** The email's card on the board (an executed card with a column), if it has one. */
export const findEmailCard = (store: Db, userId: string, emailId: string) =>
  [...store.actions.values()].find((a) => a.user_id === userId && a.email_id === emailId && a.board_column !== null && a.status === 'done')

/** Makes the email's board card if it has none: To do, or Done if already handled. Returns it and whether it's new. */
export function makeEmailCard(store: Db, userId: string, email: EmailRow): { card: ActionRow; made: boolean } {
  const have = findEmailCard(store, userId, email.id)
  if (have) return { card: have, made: false }
  const column: BoardColumn = store.handled.get(userId)?.has(email.id) ? 'done' : 'todo'
  const at = new Date().toISOString()
  const card: ActionRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    email_id: email.id,
    type: 'add_board_card',
    origin: 'rule',
    status: 'done',
    payload: { title: email.subject ?? '(no subject)', description: null, priority: null, due_date: null, start: null, end: null, attendees: null },
    board_column: column,
    board_position: [...store.actions.values()].filter((x) => x.user_id === userId && x.board_column === column).length,
    external_ref: null,
    external_status: null,
    error: null,
    created_at: at,
    updated_at: at,
  }
  store.actions.set(card.id, card)
  return { card, made: true }
}

/** Every email already in a project gets its card (seed data, and snapshots saved before §23). */
export function backfillEmailCards(store: Db) {
  for (const i of store.projectItems) {
    const e = i.email_id ? store.emails.get(i.email_id) : undefined
    if (e) makeEmailCard(store, e.user_id, e)
  }
}
