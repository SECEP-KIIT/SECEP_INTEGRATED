import { useState } from 'react'
import { acceptAction, emailDetailOptions, queryClient, undoAction, updateEmail } from '../api/queries'
import type { Action, EmailListItem } from '../api/types'
import { goTo, HANDLED_PAGE_HREF } from '../lib/navigate'
import { errorText, useInbox, type InboxApi, type OpenOptions } from './inboxContext'
import { useLift } from './liftContext'

export type Busy = 'jira' | 'calendar' | 'done' | 'pin' | null
type Compose = NonNullable<OpenOptions['compose']>

/** Matches the card fade in inbox.css: the card fades, then leaves the list (item 9 "card removal"). */
const LEAVE_MS = 120

/**
 * Sends the email's proposal of this type as is (FR-ORC-012). null when there's nothing to send as is (the caller
 * opens the composer instead).
 */
export async function sendProposal(emailId: string, type: Compose): Promise<Action | null> {
  const detail = await queryClient.fetchQuery(emailDetailOptions(emailId))
  const proposal = detail.actions.find((a) => a.type === type && (a.status === 'proposed' || a.status === 'failed'))
  return proposal ? acceptAction(proposal) : null
}

/** FR-UI-029: undo deletes the created issues or events (POST /actions/:id/undo), within ~10 s. */
export const undoSends = (done: Action[], toast: InboxApi['toast']) => ({
  label: 'Undo',
  run: () =>
    void Promise.all(done.map(undoAction)).then(
      () => toast(done[0].type === 'create_jira_issue' ? `Deleted from Jira` : 'Removed from your calendar'),
      (err: unknown) => toast(errorText(err), 'error'),
    ),
})

/** "See": the dashboard's Handled page (QA pass 5). */
export const seeHandled = { label: 'See', run: () => goTo(HANDLED_PAGE_HREF) }

/**
 * Done / Restore for several emails, with Undo (FR-UI-029) and, after Done, See (the Handled page). Undo puts the
 * cards back in place in the lists they left, not behind the "↑ n new" pill (QA pass 5).
 */
export async function setHandled(ids: readonly string[], handled: boolean, toast: InboxApi['toast']) {
  await Promise.all(ids.map((id) => updateEmail(id, { handled })))
  const n = ids.length === 1 ? '' : `${ids.length} emails `
  const undo = {
    label: 'Undo',
    run: () =>
      void Promise.all(ids.map((id) => updateEmail(id, { handled: !handled }, { restore: true }))).then(
        () => toast(handled ? `${n}Back in the inbox` : `${n}Back under Handled`),
        (err: unknown) => toast(errorText(err), 'error'),
      ),
  }
  if (handled) toast(`${n}Marked as handled. Find ${ids.length === 1 ? 'it' : 'them'} under Handled.`, 'info', undo, seeHandled)
  else toast(`${n}Back in the inbox`, 'info', undo)
}

/**
 * The card's quick actions (FR-UI-011 layer 2), shared by the hover bar (desktop) and the long-press menu (touch).
 * Jira and Calendar send the decoder's proposal as is (FR-ORC-012); `edit`, or no proposal to send, opens the
 * drawer's composer instead. Done marks the email handled (proposals §10.3); in the Handled view it restores it.
 * Pin is PATCH /emails/:id {pinned} (FR-UI-029).
 */
export function useQuickActions(email: EmailListItem, onLeave: (leaving: boolean) => void) {
  const { open: openDrawer, toast } = useInbox()
  const lift = useLift()
  const [busy, setBusy] = useState<Busy>(null)
  // Opening the drawer drops the lift or menu the actions sit in.
  const open = (opts?: OpenOptions) => {
    lift?.hide()
    openDrawer(email.id, opts)
  }

  const send = async (type: Compose, edit = false) => {
    if (edit) return open({ compose: type })
    setBusy(type === 'create_jira_issue' ? 'jira' : 'calendar')
    try {
      const result = await sendProposal(email.id, type)
      if (!result) return open({ compose: type })
      // No delay before sending (item 8): it happens now, and Undo deletes it again (FR-UI-029).
      if (result.status === 'done') toast(type === 'create_jira_issue' ? `Sent to Jira · ${result.external_ref}` : 'Added to your calendar', 'info', undoSends([result], toast))
      else toast(`Couldn't send it: ${result.error ?? 'the action failed'}. Retry from the details.`, 'error')
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggleHandled = async () => {
    setBusy('done')
    onLeave(true)
    try {
      await Promise.all([setHandled([email.id], !email.handled, toast), new Promise((r) => setTimeout(r, LEAVE_MS))])
    } catch (err) {
      onLeave(false)
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const togglePin = async () => {
    setBusy('pin')
    try {
      await updateEmail(email.id, { pinned: !email.pinned })
      toast(email.pinned ? 'Unpinned' : 'Pinned')
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggleRead = async () => {
    try {
      await updateEmail(email.id, { read: !email.read })
      toast(email.read ? 'Marked as unread' : 'Marked as read')
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  return { busy, send, toggleHandled, togglePin, toggleRead, open }
}
