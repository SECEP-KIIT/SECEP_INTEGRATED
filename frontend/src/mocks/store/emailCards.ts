// An email in a project is a task on that project's board (proposals §23): adding it to a project gives it a board
// card in To do (Done if already handled); marking the email handled moves its card to Done and back; moving the
// card into or out of Done marks the email handled or not. One card per email, shared by every project it is in.
import type { BoardColumn } from '../../api/types'
import { db } from './db'
import { publish } from './events'
import { handledOf } from './generate'
import { toAction, toListItem } from './serialize'
import { findEmailCard, makeEmailCard } from './emailCardsCore'
import type { ActionRow, EmailRow } from './types'

const now = () => new Date().toISOString()

export const emailCard = (userId: string, emailId: string) => findEmailCard(db, userId, emailId)

/** Puts the card at the bottom of `column` and closes the gap it left. */
function moveToEnd(a: ActionRow, column: BoardColumn) {
  const from = a.board_column
  const inCol = [...db.actions.values()].filter((x) => x.user_id === a.user_id && x.board_column === column && x !== a)
  a.board_column = column
  a.board_position = inCol.length
  a.updated_at = now()
  if (from && from !== column)
    [...db.actions.values()]
      .filter((x) => x.user_id === a.user_id && x.board_column === from)
      .sort((x, y) => (x.board_position ?? 0) - (y.board_position ?? 0))
      .forEach((c, i) => (c.board_position = i))
}

const emitCard = (a: ActionRow) => publish(a.user_id, 'action.updated', { action: toAction(a) })

/** Adding an email to a project: make sure it has a board card. */
export function ensureEmailCard(userId: string, email: EmailRow): ActionRow {
  const { card, made } = makeEmailCard(db, userId, email)
  if (made) emitCard(card)
  return card
}

/** The email was marked handled or not: its card follows (Done, or back to To do). */
export function cardFollowsEmail(userId: string, emailId: string, handled: boolean) {
  const a = emailCard(userId, emailId)
  if (!a) return
  if (handled && a.board_column !== 'done') moveToEnd(a, 'done')
  else if (!handled && a.board_column === 'done') moveToEnd(a, 'todo')
  else return
  emitCard(a)
}

/** The card moved on the board: into Done marks its email handled, out of Done marks it not handled. */
export function emailFollowsCard(a: ActionRow) {
  if (!a.email_id) return
  const email = db.emails.get(a.email_id)
  if (!email) return
  const handled = handledOf(db, a.user_id)
  const done = a.board_column === 'done'
  if (done === handled.has(email.id)) return
  if (done) handled.set(email.id, now())
  else handled.delete(email.id)
  publish(a.user_id, 'email.triaged', { email_id: email.id, email: toListItem(db, email) })
}
