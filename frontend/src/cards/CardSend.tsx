import { useQuery } from '@tanstack/react-query'
import { AlarmClock, Zap } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../api/client'
import { cardSendsOptions, sendCard, undoAction, useMe, useProjects } from '../api/queries'
import type { Action, DecoderActionPayload, JiraTarget, UserCardPayload } from '../api/types'
import { cardDraft, type SendType } from './cardDraft'
import { Composer } from '../drawer/Composer'
import '../drawer/drawer.css'
import { errorText } from '../inbox/inboxContext'
import { RemindPicker } from '../inbox/RemindPicker'
import type { PickerAt } from '../inbox/ProjectPicker'
import { shellToast } from '../lib/toastBus'

type Card = Action & { payload: UserCardPayload }
const fieldErrors = (err: unknown): Record<string, string> =>
  err instanceof ApiError && (err.code === 'validation_failed' || err.code === 'action_invalid')
    ? (((err.details as { fields?: Record<string, string> } | null)?.fields) ?? {})
    : {}

/**
 * A card's "Send to" (FR-CNT-002 "same actions", proposals §27.2): Jira or Calendar through the same composer as an
 * email's actions, with the Jira target from the card's primary project; plus Remind me. What was sent is listed.
 */
export function CardSend({ card }: { card: Card }) {
  const sends = useQuery(cardSendsOptions(card.id))
  const { data: projects } = useProjects()
  const { data: me } = useMe()
  const [composing, setComposing] = useState<SendType | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [remind, setRemind] = useState<PickerAt | null>(null)

  const primary = card.projects.find((r) => r.is_primary)
  const project = primary && projects?.items.find((x) => x.id === primary.id)
  const target = project?.jira_project_key ? { project_key: project.jira_project_key, epic: project.jira_epic, from: project.name } : { project_key: null, epic: null, from: null }

  const submit = async (payload: DecoderActionPayload, jira?: JiraTarget) => {
    if (!composing) return
    setBusy(true)
    setError(null)
    try {
      const done = await sendCard(card.id, composing, payload, jira)
      setComposing(null)
      if (done.status === 'done') {
        shellToast(composing === 'create_jira_issue' ? `Created ${done.external_ref ?? 'the Jira issue'}` : 'Added to your calendar', 'info', { label: 'Undo', run: () => void undoAction(done) })
      } else shellToast(done.error ?? "Couldn't send it", 'error')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  // Calendar is v2: calendar sends are not listed.
  const items = (sends.data?.items ?? []).filter((a) => a.status !== 'rejected' && a.type === 'create_jira_issue')
  return (
    <div className="card-send">
      {items.length > 0 && (
        <ul className="card-sends">
          {items.map((a) => (
            <li key={a.id} data-status={a.status}>
              <Zap size={14} aria-hidden="true" />
              <span className="card-send-title">{(a.payload as DecoderActionPayload).title ?? 'Untitled'}</span>
              <span className="card-send-state">
                {a.status === 'done'
                  ? `${a.external_ref ?? 'Jira'}${a.external_status ? ` · ${a.external_status}` : ''}`
                  : a.status === 'failed'
                    ? (a.error ?? 'Failed')
                    : a.status === 'executing'
                      ? 'Sending…'
                      : 'Not sent'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {composing ? (
        <>
          {error !== null && Object.keys(fieldErrors(error)).length === 0 && (
            <p className="action-error" role="alert">
              {errorText(error)}
            </p>
          )}
          <Composer
            type={composing}
            initial={cardDraft(card.payload, composing, new Date(), me?.email ?? null)}
            submitLabel={composing === 'create_jira_issue' ? 'Send to Jira' : 'Add to calendar'}
            busy={busy}
            errors={fieldErrors(error)}
            jira={composing === 'create_jira_issue' ? target : undefined}
            onSubmit={(p, j) => void submit(p, j)}
            onCancel={() => {
              setComposing(null)
              setError(null)
            }}
          />
        </>
      ) : (
        <div className="card-send-buttons">
          <button type="button" className="ghost-button" onClick={() => setComposing('create_jira_issue')}>
            <Zap size={14} aria-hidden="true" /> Jira
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setRemind({ ids: [card.id], x: r.left, y: r.bottom })
            }}
          >
            <AlarmClock size={14} aria-hidden="true" /> Remind me
          </button>
        </div>
      )}
      {remind && <RemindPicker at={remind} target={{ type: 'card', title: card.payload.title }} container={document.querySelector<HTMLElement>('dialog.card-sheet[open]')} onClose={() => setRemind(null)} />}
    </div>
  )
}
