import { acceptAction, createAction, createCard, undoAction } from '../api/queries'
import type { EmailDetail } from '../api/types'
import { openCard } from '../cards/cardBus'
import { shellToast } from '../lib/toastBus'
import { NotesAttach } from './NotesAttach'

/**
 * Notes and attachments in the email drawer (FR-CNT-003/006). Every open `- [ ]` line offers → Card (a user card, filed in the email's projects) and → Jira (an issue from this email).
 */
export function EmailNotes({ email }: { email: EmailDetail }) {
  const toCard = async (title: string) => {
    try {
      const card = await createCard({ title: title.slice(0, 120) }, email.projects.map((p) => p.id))
      shellToast(`Added "${card.payload.title}" to To do`, 'info', { label: 'Open', run: () => openCard(card.id) })
    } catch (e) {
      shellToast(e instanceof Error ? e.message : "Couldn't add the card", 'error')
    }
  }
  const toJira = async (title: string) => {
    try {
      const a = await createAction(email.id, 'create_jira_issue', { title: title.slice(0, 120) })
      const done = await acceptAction(a)
      shellToast(done.status === 'done' ? `Created ${done.external_ref ?? 'the Jira issue'}` : (done.error ?? "Jira didn't take it"), done.status === 'done' ? 'info' : 'error', done.status === 'done' ? { label: 'Undo', run: () => void undoAction(done) } : undefined)
    } catch (e) {
      shellToast(e instanceof Error ? e.message : "Couldn't create the Jira issue", 'error')
    }
  }
  return (
    <NotesAttach
      target={{ type: 'email', id: email.id }}
      taskTools={(text) => (
        <>
          <button type="button" onClick={() => void toCard(text)} title="Make a card from this line">
            → Card
          </button>
          <button type="button" onClick={() => void toJira(text)} title="Make a Jira issue from this line">
            → Jira
          </button>
        </>
      )}
    />
  )
}
