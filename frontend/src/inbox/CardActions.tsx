import { useKeyLabel } from '../lib/keybinds'
import { CircleCheck, Ellipsis, FolderPlus, Undo2, Zap } from 'lucide-react'
import type { EmailListItem } from '../api/types'
import { useInbox } from './inboxContext'
import { useQuickActions } from './quickActions'

/**
 * Card layer 2 (FR-UI-011, item 3): Jira · Project · Done · ⋯, in the bar above a lifted card (CardLift, QA pass 3),
 * never changing the card's height. Touch has the long-press menu instead (TouchActions).
 *
 * Jira sends the decoder's proposal as is (FR-ORC-012); Shift+click opens the drawer's composer first.
 */
export function CardActions({ email, onLeave }: { email: EmailListItem; onLeave: (leaving: boolean) => void }) {
  const { busy, send, toggleHandled, open } = useQuickActions(email, onLeave)
  const { pickProject } = useInbox()
  const projectKey = useKeyLabel('project')

  return (
    <div className="card-actions" role="group" aria-label="Quick actions">
      {email.jira_key ? (
        <span className="card-action card-action-done" title={`Jira issue ${email.jira_key}`}>
          <CircleCheck size={14} aria-hidden="true" />
          {email.jira_key}
        </span>
      ) : (
        <button
          type="button"
          className="card-action"
          aria-busy={busy === 'jira' || undefined}
          disabled={busy !== null}
          title="Send to Jira (Shift+click to edit first)"
          onClick={(e) => (e.stopPropagation(), void send('create_jira_issue', e.shiftKey))}
        >
          <Zap size={14} aria-hidden="true" />
          Jira
        </button>
      )}
      <button
        type="button"
        className="card-action"
        disabled={busy !== null}
        title={`Add to project (${projectKey})`}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          pickProject([email.id], r.left, r.bottom)
        }}
      >
        <FolderPlus size={14} aria-hidden="true" />
        Project
      </button>
      <button
        type="button"
        className="card-action"
        aria-busy={busy === 'done' || undefined}
        disabled={busy !== null}
        title={email.handled ? 'Restore to the inbox' : 'Mark as handled'}
        onClick={(e) => (e.stopPropagation(), void toggleHandled())}
      >
        {email.handled ? <Undo2 size={14} aria-hidden="true" /> : <CircleCheck size={14} aria-hidden="true" />}
        {email.handled ? 'Restore' : 'Done'}
      </button>
      <button
        type="button"
        className="card-action card-action-icon"
        title="Open details"
        onClick={(e) => {
          e.stopPropagation()
          open()
        }}
      >
        <Ellipsis size={14} aria-hidden="true" />
        <span className="sr-only">Open details</span>
      </button>
    </div>
  )
}
