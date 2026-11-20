import { CircleCheck, ExternalLink, Pin, PinOff, Undo2, Zap } from 'lucide-react'
import { useEffect, useRef, type MouseEvent } from 'react'
import { MaskedText } from '../components/MaskedText'
import type { LiftTarget } from './liftContext'
import { useQuickActions } from './quickActions'

/**
 * Card actions on touch (QA pass 3): no hover bar; a tap opens the drawer and a long-press opens this menu: Jira,
 * Done, Pin, Open. A native modal <dialog> at the bottom of the screen, so focus is trapped, Esc and the
 * backdrop close it, and Focus mode's keys wait for it (anyLayerOpen).
 */
export function TouchActions({ target, onClose }: { target: LiftTarget; onClose: () => void }) {
  const { email } = target
  const ref = useRef<HTMLDialogElement>(null)
  const { busy, send, toggleHandled, togglePin, open } = useQuickActions(email, target.onLeave)
  // The finger that long-pressed is still down when this opens; its release must not count as a backdrop tap.
  const armed = useRef(false)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    const t = setTimeout(() => (armed.current = true), 400)
    return () => clearTimeout(t)
  }, [])
  const close = () => ref.current?.close()
  const onBackdrop = (e: MouseEvent) => {
    if (e.target === ref.current && armed.current) close()
  }
  const run = (fn: () => Promise<unknown> | void) => async () => {
    await fn()
    close()
  }

  return (
    <dialog ref={ref} className="action-sheet" aria-labelledby="action-sheet-title" onClose={onClose} onClick={onBackdrop}>
      <p className="action-sheet-title" id="action-sheet-title">
        {email.subject ? <MaskedText text={email.subject} /> : '(no subject)'}
      </p>
      <div className="action-sheet-list" aria-busy={busy !== null || undefined}>
        {email.jira_key ? (
          <p className="action-sheet-item action-sheet-done">
            <CircleCheck size={18} aria-hidden="true" /> In Jira as {email.jira_key}
          </p>
        ) : (
          <button type="button" className="action-sheet-item" disabled={busy !== null} onClick={run(() => send('create_jira_issue'))}>
            <Zap size={18} aria-hidden="true" /> Send to Jira
          </button>
        )}
        <button type="button" className="action-sheet-item" disabled={busy !== null} onClick={run(toggleHandled)}>
          {email.handled ? <Undo2 size={18} aria-hidden="true" /> : <CircleCheck size={18} aria-hidden="true" />}
          {email.handled ? 'Restore to the inbox' : 'Done'}
        </button>
        <button type="button" className="action-sheet-item" disabled={busy !== null} onClick={run(togglePin)}>
          {email.pinned ? <PinOff size={18} aria-hidden="true" /> : <Pin size={18} aria-hidden="true" />}
          {email.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" className="action-sheet-item" onClick={run(() => open())}>
          <ExternalLink size={18} aria-hidden="true" /> Open
        </button>
      </div>
      <button type="button" className="action-sheet-cancel" onClick={close}>
        Cancel
      </button>
    </dialog>
  )
}
