import type { Action } from '../api/types'
import { errorText, useInbox } from './inboxContext'
import { sendProposal, setHandled, undoSends } from './quickActions'
import { useSelection } from './selection'

type Compose = Parameters<typeof sendProposal>[1]

/**
 * Bulk actions on the selection (FR-UI-027/028, item 10 "bulk send"). Jira and Calendar make a separate issue or
 * event per email (the default); emails with nothing to send as is are skipped and counted. One Undo covers all.
 */
export function useBulk() {
  const { selected, clear } = useSelection()
  const { toast } = useInbox()
  const ids = [...selected]
  return {
    async send(type: Compose) {
      const results = await Promise.allSettled(ids.map((id) => sendProposal(id, type)))
      const done = results.flatMap((r) => (r.status === 'fulfilled' && r.value?.status === 'done' ? [r.value] : [])) as Action[]
      const skipped = results.length - done.length
      const what = type === 'create_jira_issue' ? 'Jira' : 'your calendar'
      const tail = skipped ? ` · ${skipped} need${skipped === 1 ? 's' : ''} details, open ${skipped === 1 ? 'it' : 'them'} to send` : ''
      if (done.length) toast(`Sent ${done.length} to ${what}${tail}`, 'info', undoSends(done, toast))
      else toast(`Nothing sent: ${skipped === 1 ? 'this email needs' : 'these emails need'} details first`, 'error')
      clear()
    },
    async done() {
      try {
        await setHandled(ids, true, toast)
        clear()
      } catch (err) {
        toast(errorText(err), 'error')
      }
    },
  }
}

